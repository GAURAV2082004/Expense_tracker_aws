# Builds the React app against the deployed API, uploads it to S3, and refreshes CloudFront.
# Run from the project root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\deploy-frontend.ps1
# Credentials come from ~/.aws/credentials. Do not set AWS_ACCESS_KEY_ID in the terminal.
param(
  [string]$Stack = "expense-tracker-day02",
  [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"

function Assert-Ok($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

function Get-StackOutput($key) {
  $value = aws cloudformation describe-stacks --stack-name $Stack --region $Region `
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" --output text
  Assert-Ok "Reading stack output $key"
  if (-not $value -or $value -eq "None") { throw "Stack output $key not found. Did 'sam deploy' finish?" }
  return $value.Trim()
}

$apiUrl = Get-StackOutput "ApiUrl"
$bucket = Get-StackOutput "SiteBucketName"
$distId = Get-StackOutput "DistributionId"

Push-Location frontend
try {
  if (-not (Test-Path node_modules\.bin\vite.cmd)) {
    npm install
    Assert-Ok "npm install"
  }
  $env:VITE_API_URL = $apiUrl
  npm run build;     Assert-Ok "npm run build"
}
finally {
  Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
  Pop-Location
}

# Hashed assets can be cached for a year; index.html must always be revalidated.
aws s3 sync frontend\dist\assets "s3://$bucket/assets" --delete `
  --cache-control "public,max-age=31536000,immutable" --region $Region
Assert-Ok "Uploading assets"

aws s3 cp frontend\dist\index.html "s3://$bucket/index.html" `
  --cache-control "no-cache" --content-type "text/html" --region $Region
Assert-Ok "Uploading index.html"

aws cloudfront create-invalidation --distribution-id $distId --paths "/index.html" | Out-Null
Assert-Ok "CloudFront invalidation"

Write-Host "Live at: $(Get-StackOutput 'SiteUrl')"
