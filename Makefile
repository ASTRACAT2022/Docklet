.PHONY: all proto build frontend certs run-hub run-agent auth

# Default target: build everything
all: frontend build certs

proto:
	PATH=$$(go env GOPATH)/bin:$$PATH protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    api/proto/v1/docklet.proto

frontend:
	@echo "📦 Building Dashboard..."
	cd web/dashboard && npm install && npm run build

build:
	@echo "🔨 Compiling binaries..."
	go build -o bin/hub ./cmd/hub
	go build -o bin/agent ./cmd/agent
	go build -o bin/cli ./cmd/cli
	go build -o bin/certgen ./cmd/certgen

certs:
	@echo "🔐 Generating Certificates..."
	go run cmd/certgen/main.go

run-hub:
	./bin/hub

run-agent:
	./bin/agent
