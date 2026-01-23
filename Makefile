.PHONY: proto build run-hub run-agent

proto:
	PATH=$$(go env GOPATH)/bin:$$PATH protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    api/proto/v1/docklet.proto

build:
	go build -o bin/hub ./cmd/hub
	go build -o bin/agent ./cmd/agent
	go build -o bin/cli ./cmd/cli

run-hub:
	go run ./cmd/hub

run-agent:
	go run ./cmd/agent
