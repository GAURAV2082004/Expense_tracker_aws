param(
  [string]$Email = "gjadli22comp@student.mes.ac.in",
  [double]$Amount = 1.00
)

$ErrorActionPreference = "Stop"

Write-Host "Fetching AWS Account ID..."
$accountId = (aws sts get-caller-identity --query "Account" --output text).Trim()

if (-not $accountId) {
  throw "Could not retrieve AWS Account ID. Make sure 'aws configure' has valid credentials."
}

Write-Host "Creating a `$$Amount monthly budget for account $accountId with alerts sent to $Email..."

$budgetJson = @"
{
  "BudgetName": "Monthly-$($Amount)-Dollar-Limit",
  "BudgetLimit": {
    "Amount": "$Amount",
    "Unit": "USD"
  },
  "CostTypes": {
    "IncludeTax": true,
    "IncludeSubscription": true,
    "UseBlended": false
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
"@

$notificationsJson = @"
[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80.0,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      {
        "SubscriptionType": "EMAIL",
        "Address": "$Email"
      }
    ]
  },
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 100.0,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      {
        "SubscriptionType": "EMAIL",
        "Address": "$Email"
      }
    ]
  }
]
"@

$tempBudget = Join-Path $env:TEMP "aws_budget_$([guid]::NewGuid().ToString('N')).json"
$tempNotif = Join-Path $env:TEMP "aws_notif_$([guid]::NewGuid().ToString('N')).json"

try {
  Set-Content -Path $tempBudget -Value $budgetJson -Encoding utf8
  Set-Content -Path $tempNotif -Value $notificationsJson -Encoding utf8

  aws budgets create-budget `
    --account-id $accountId `
    --budget file://$tempBudget `
    --notifications-with-subscribers file://$tempNotif

  Write-Host "Budget successfully created! You will receive alert emails at $Email if spending exceeds 80% (`$$($Amount * 0.8)) or 100% (`$$Amount)." -ForegroundColor Green
}
finally {
  Remove-Item $tempBudget, $tempNotif -ErrorAction SilentlyContinue
}
