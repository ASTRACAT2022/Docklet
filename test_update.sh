#!/bin/bash
echo "1. Deploying Nginx v1..."
curl -X POST http://localhost:8080/api/deploy -d '{"image": "nginx:latest"}' -H "Content-Type: application/json" > app.json
echo ""

APP_ID=$(cat app.json | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "App ID: $APP_ID"

echo "2. Updating App to Nginx v2 (creating revision)..."
curl -X POST http://localhost:8080/api/apps/$APP_ID/update -d '{"image": "nginx:alpine"}' -H "Content-Type: application/json"
echo ""

echo "3. Checking App Status..."
curl http://localhost:8080/api/apps
echo ""
