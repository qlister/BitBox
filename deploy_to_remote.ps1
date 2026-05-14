# =============================================================================
# deploy_to_remote.ps1
#
# Helper script to build local docker images, push them to the local registry
# (bb-lnx02:5000), and SCP the configuration files to the remote server.
#
# Ensure you have already committed your changes before or after running this.
# =============================================================================

Write-Host "Building Docker images..."
docker-compose build

Write-Host "Pushing Docker images to registry bb-lnx02:5000..."
docker image push bb-lnx02:5000/bitbox-portal
docker image push bb-lnx02:5000/bitbox-planner
docker image push bb-lnx02:5000/bitbox-purchasing
docker image push bb-lnx02:5000/erp-query-engine

Write-Host "Copying configuration files to remote server..."
pscp "C:\Users\qlister\AI\BitBox\docker-compose.yml" qlister@bb-lnx02:
pscp "C:\Users\qlister\AI\BitBox\.env" qlister@bb-lnx02:

# Create the erp_query_engine directory if it doesn't exist, though pscp doesn't do mkdir.
# Assuming it exists because it's in the command the user provided.
pscp "C:\Users\qlister\AI\BitBox\erp_query_engine\.env" qlister@bb-lnx02:/home/qlister/erp_query_engine/.env
pscp -r "C:\Users\qlister\AI\BitBox\erp_query_engine\training" qlister@bb-lnx02:/home/qlister/erp_query_engine/

Write-Host "Done! On the remote server, you can now run:"
Write-Host "  docker-compose pull"
Write-Host "  docker-compose up -d"
