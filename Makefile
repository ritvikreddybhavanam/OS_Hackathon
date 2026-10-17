# Makefile for IPC Chat - Inter-Process Communication in Real Time
CC = gcc
CFLAGS = -Wall -Wextra -Wpedantic -std=c11 -O2

.PHONY: all install build start stop test clean help

all: build

help:
	@echo "Available commands for IPC Chat:"
	@echo "  make install  - Install npm dependencies for backend and frontend"
	@echo "  make build    - Compile C worker and build frontend production bundle"
	@echo "  make start    - Launch backend and frontend services via start.sh"
	@echo "  make stop     - Safely terminate all IPC Chat processes via stop.sh"
	@echo "  make test     - Execute automated C worker and backend integration tests"
	@echo "  make clean    - Remove compiled C binary and frontend build artifacts"

install:
	@echo "Installing backend dependencies..."
	cd backend && npm install
	@echo "Installing frontend dependencies..."
	cd frontend && npm install

build: ipc/chat_worker
	@echo "Building frontend production assets..."
	cd frontend && npm run build

ipc/chat_worker: ipc/chat_worker.c
	@echo "Compiling C worker binary with $(CC) $(CFLAGS)..."
	$(CC) $(CFLAGS) ipc/chat_worker.c -o ipc/chat_worker

start:
	@bash scripts/start.sh

stop:
	@bash scripts/stop.sh

test: ipc/chat_worker
	@echo "Running test suite..."
	@bash tests/ipc_worker_test.sh
	@bash tests/api_test.sh

clean:
	@echo "Cleaning compiled artifacts..."
	rm -f ipc/chat_worker
	rm -rf frontend/dist
	rm -rf logs/*.log
