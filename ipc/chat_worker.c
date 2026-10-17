/**
 * IPC Chat Worker
 * 
 * An independent Linux C process that communicates with the Node.js backend
 * via OS-managed anonymous pipes (stdin/stdout/stderr).
 *
 * Protocol: JSON Lines (one JSON object per line, terminated by '\n')
 * Input (stdin):  {"id":"...","from":"...","to":"...","text":"...","timestamp":"..."}
 * Output (stdout): {"type":"ack","id":"...","sender":"...","recipient":"...","recipientPid":...,"status":"delivered","processedCount":...}
 * Diagnostics (stderr): Human-readable logs with timestamps and PID
 */

#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <ctype.h>

#define BUFFER_SIZE 8192
#define MAX_FIELD_LEN 1024
#define MAX_TEXT_LEN 4096

/* Utility to get current UNIX epoch timestamp in seconds */
static long get_current_time(void) {
    return (long)time(NULL);
}

/**
 * Safe JSON string extractor for a given key in a single-line JSON string.
 * Looks for "key"\s*:\s*"value" and extracts "value", properly handling escapes.
 * Returns 1 on success, 0 if key not found or format invalid.
 */
static int json_get_string(const char *json, const char *key, char *out, size_t out_size) {
    if (!json || !key || !out || out_size == 0) return 0;
    out[0] = '\0';

    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);

    const char *p = strstr(json, pattern);
    if (!p) return 0;

    p += strlen(pattern);

    /* Skip whitespace */
    while (*p && (*p == ' ' || *p == '\t')) p++;

    /* Expect colon */
    if (*p != ':') return 0;
    p++;

    /* Skip whitespace */
    while (*p && (*p == ' ' || *p == '\t')) p++;

    /* Expect opening quote */
    if (*p != '"') return 0;
    p++;

    size_t idx = 0;
    while (*p && *p != '"' && idx < out_size - 1) {
        if (*p == '\\') {
            p++;
            if (!*p) break;
            switch (*p) {
                case '"':  out[idx++] = '"'; break;
                case '\\': out[idx++] = '\\'; break;
                case '/':  out[idx++] = '/'; break;
                case 'b':  out[idx++] = '\b'; break;
                case 'f':  out[idx++] = '\f'; break;
                case 'n':  out[idx++] = '\n'; break;
                case 'r':  out[idx++] = '\r'; break;
                case 't':  out[idx++] = '\t'; break;
                default:   out[idx++] = *p; break;
            }
            p++;
        } else {
            out[idx++] = *p++;
        }
    }

    if (*p != '"') {
        /* String was either unclosed or truncated */
        out[0] = '\0';
        return 0;
    }

    out[idx] = '\0';
    return 1;
}

/**
 * Safely escape a C string into JSON format (escaping quotes, backslashes, controls).
 */
static void json_escape(const char *in, char *out, size_t out_size) {
    if (!in || !out || out_size == 0) return;
    size_t o = 0;
    for (size_t i = 0; in[i] != '\0' && o < out_size - 6; i++) {
        unsigned char c = (unsigned char)in[i];
        if (c == '"') {
            out[o++] = '\\'; out[o++] = '"';
        } else if (c == '\\') {
            out[o++] = '\\'; out[o++] = '\\';
        } else if (c == '\n') {
            out[o++] = '\\'; out[o++] = 'n';
        } else if (c == '\r') {
            out[o++] = '\\'; out[o++] = 'r';
        } else if (c == '\t') {
            out[o++] = '\\'; out[o++] = 't';
        } else if (c < 32) {
            o += snprintf(out + o, out_size - o, "\\u%04x", c);
        } else {
            out[o++] = c;
        }
    }
    out[o] = '\0';
}

int main(int argc, char *argv[]) {
    const char *process_name = (argc > 1 && argv[1][0] != '\0') ? argv[1] : "Worker";
    pid_t pid = getpid();
    int message_count = 0;
    char buffer[BUFFER_SIZE];

    /* Disable buffering or use line buffering for immediate IPC flushing */
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stderr, NULL, _IOLBF, 0);

    /* Diagnostic log to stderr with PID */
    fprintf(stderr, "[%s] Process started | PID: %d | PPID: %d | Architecture: Linux C (ELF)\n",
            process_name, (int)pid, (int)getppid());
    fprintf(stderr, "[%s] Listening for JSON Lines messages on stdin (pipe fd 0)...\n", process_name);

    /* Read lines from stdin until EOF */
    while (fgets(buffer, sizeof(buffer), stdin) != NULL) {
        /* Strip trailing newlines */
        size_t len = strlen(buffer);
        while (len > 0 && (buffer[len - 1] == '\n' || buffer[len - 1] == '\r')) {
            buffer[--len] = '\0';
        }

        /* Ignore empty lines */
        if (len == 0) {
            continue;
        }

        /* Check for ping / health check */
        char type_str[64] = {0};
        json_get_string(buffer, "type", type_str, sizeof(type_str));

        char id_str[MAX_FIELD_LEN] = {0};
        json_get_string(buffer, "id", id_str, sizeof(id_str));

        if (strcmp(type_str, "ping") == 0) {
            /* Respond to ping */
            printf("{\"type\":\"pong\",\"id\":\"%s\",\"worker\":\"%s\",\"pid\":%d,\"status\":\"ok\",\"uptime\":%ld}\n",
                   id_str[0] ? id_str : "ping", process_name, (int)pid, get_current_time());
            fflush(stdout);
            continue;
        }

        /* Extract message fields */
        char from_str[MAX_FIELD_LEN] = {0};
        char to_str[MAX_FIELD_LEN] = {0};
        char text_str[MAX_TEXT_LEN] = {0};

        int has_from = json_get_string(buffer, "from", from_str, sizeof(from_str));
        int has_to   = json_get_string(buffer, "to", to_str, sizeof(to_str));
        int has_text = json_get_string(buffer, "text", text_str, sizeof(text_str));

        if (has_to && strcmp(to_str, process_name) != 0) {
            fprintf(stderr, "[%s] [PID %d] Notice: Received message addressed to '%s'\n",
                    process_name, (int)pid, to_str);
        }

        if (!has_from || !has_text) {
            fprintf(stderr, "[%s] [PID %d] ERROR: Malformed message received: %s\n",
                    process_name, (int)pid, buffer);

            char escaped_id[MAX_FIELD_LEN * 2];
            json_escape(id_str, escaped_id, sizeof(escaped_id));

            printf("{\"type\":\"error\",\"id\":\"%s\",\"recipient\":\"%s\",\"recipientPid\":%d,\"status\":\"error\",\"error\":\"Malformed JSON: missing 'from' or 'text'\"}\n",
                   escaped_id, process_name, (int)pid);
            fflush(stdout);
            continue;
        }

        message_count++;

        /* Diagnostic log to stderr */
        fprintf(stderr, "[%s] [PID %d] Received message #%d from '%s': \"%.60s%s\"\n",
                process_name, (int)pid, message_count, from_str, text_str,
                strlen(text_str) > 60 ? "..." : "");

        /* Prepare escaped fields for JSON response */
        char esc_id[MAX_FIELD_LEN * 2];
        char esc_from[MAX_FIELD_LEN * 2];
        char esc_recipient[MAX_FIELD_LEN * 2];
        char esc_text[MAX_TEXT_LEN * 2];

        json_escape(id_str, esc_id, sizeof(esc_id));
        json_escape(from_str, esc_from, sizeof(esc_from));
        json_escape(process_name, esc_recipient, sizeof(esc_recipient));
        json_escape(text_str, esc_text, sizeof(esc_text));

        /* Emit structured acknowledgement via stdout (OS pipe) */
        printf("{\"type\":\"ack\",\"id\":\"%s\",\"sender\":\"%s\",\"recipient\":\"%s\",\"recipientPid\":%d,\"text\":\"%s\",\"status\":\"delivered\",\"processedCount\":%d,\"receivedAt\":%ld}\n",
               esc_id, esc_from, esc_recipient, (int)pid, esc_text, message_count, get_current_time());
        fflush(stdout);
    }

    /* EOF reached when Node.js closes the pipe or during shutdown */
    fprintf(stderr, "[%s] [PID %d] Pipe closed (EOF). Worker exiting gracefully. Total messages processed: %d\n",
            process_name, (int)pid, message_count);

    return 0;
}
