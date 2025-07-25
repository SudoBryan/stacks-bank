# Stacks Bank - DeFi Lending & Staking Protocol

A robust decentralized finance (DeFi) smart contract built on the Stacks blockchain that enables users to stake STX tokens to earn interest and take collateralized loans.

## Features

### 🏦 Core Banking Functions
- **Stake STX**: Deposit STX tokens to earn interest over time
- **Withdraw Stakes**: Withdraw staked funds along with accumulated interest
- **Take Loans**: Borrow STX against staked collateral (up to 66.7% loan-to-value ratio)
- **Repay Loans**: Make partial or full loan repayments with interest

### 📊 Interest & Risk Management
- **Dynamic Interest Calculation**: Real-time interest computation based on block height
- **Collateralization Requirements**: 150% minimum collateral ratio to prevent under-collateralization
- **Liquidation Mechanism**: Automatic liquidation of risky loans to protect the protocol
- **Interest Rates**: Configurable stake (5% default) and loan (8% default) annual interest rates

### 🛡️ Security & Administration
- **Access Controls**: Owner-only administrative functions
- **Emergency Pause**: Circuit breaker mechanism for emergency situations
- **Robust Error Handling**: Comprehensive error codes and validation
- **Multi-user Support**: Concurrent operations by multiple users

## Contract Architecture

### Constants
- `MINIMUM-STAKE`: 1 STX minimum stake requirement
- `MINIMUM-LOAN`: 0.5 STX minimum loan amount
- `LIQUIDATION-THRESHOLD`: 150% collateralization ratio
- `MAX-INTEREST-RATE`: 20% maximum annual interest rate

### Data Structures

#### Stakes Map
```clarity
{
  amount: uint,           ;; Staked amount in microSTX
  timestamp: uint,        ;; Initial stake timestamp
  last-interest-update: uint ;; Last interest calculation block
}
```

#### Loans Map
```clarity
{
  amount: uint,           ;; Loan principal amount
  collateral: uint,       ;; Collateral amount locked
  timestamp: uint,        ;; Loan creation timestamp  
  last-interest-update: uint ;; Last interest calculation block
}
```

## Public Functions

### User Functions

#### `stake(amount: uint)`
Stake STX tokens to earn interest.
- **Parameters**: `amount` - Amount to stake in microSTX (minimum 1 STX)
- **Returns**: Staked amount on success
- **Requirements**: Contract not paused, amount ≥ minimum stake

#### `withdraw-stake(amount: uint)`
Withdraw staked STX tokens with earned interest.
- **Parameters**: `amount` - Amount to withdraw in microSTX
- **Returns**: Withdrawn amount on success
- **Requirements**: Sufficient staked balance including interest

#### `take-loan(amount: uint)`
Take a loan against staked collateral.
- **Parameters**: `amount` - Loan amount in microSTX (minimum 0.5 STX)
- **Returns**: Loan amount on success
- **Requirements**: Sufficient collateral (150% ratio), no existing loan

#### `repay-loan(amount: uint)`
Repay loan principal and interest.
- **Parameters**: `amount` - Repayment amount in microSTX
- **Returns**: Repaid amount on success
- **Requirements**: Active loan, amount ≤ total debt

#### `liquidate(borrower: principal)`
Liquidate an under-collateralized loan.
- **Parameters**: `borrower` - Address of the borrower to liquidate
- **Returns**: Collateral amount seized
- **Requirements**: Loan must be under-collateralized (< 150% ratio)

### Admin Functions (Owner Only)

#### `set-stake-interest-rate(new-rate: uint)`
Set the annual interest rate for stakes (in basis points).
- **Parameters**: `new-rate` - New rate (e.g., 500 = 5%)

#### `set-loan-interest-rate(new-rate: uint)`
Set the annual interest rate for loans (in basis points).
- **Parameters**: `new-rate` - New rate (e.g., 800 = 8%)

#### `toggle-contract-pause()`
Pause or unpause the contract.
- **Returns**: New pause status

#### `emergency-withdraw(amount: uint)`
Emergency withdrawal function (only when paused).
- **Parameters**: `amount` - Amount to withdraw

## Read-Only Functions

### Information Queries

#### `get-stake(user: principal)`
Get stake information for a user.

#### `get-loan(user: principal)`
Get loan information for a user.

#### `get-accumulated-interest(user: principal)`
Get accumulated interest for a user.

#### `get-contract-stats()`
Get overall contract statistics (total staked, borrowed, rates, etc.).

### Calculations

#### `calculate-stake-interest(user: principal)`
Calculate current stake interest earned.

#### `calculate-loan-interest(user: principal)`
Calculate current loan interest owed.

#### `get-total-debt(user: principal)`
Get total debt including principal and interest.

#### `is-liquidatable(user: principal)`
Check if a loan is eligible for liquidation.

## Interest Calculation

Interest is calculated using simple interest formula:
```
Interest = Principal × Rate × Time / (365 days in basis points)
```

Where:
- Time is measured in blocks (assuming ~6 blocks per minute)
- Rates are in basis points (100 basis points = 1%)
- Interest accrues continuously based on block height

## Usage Examples

### Staking STX
```clarity
;; Stake 10 STX
(contract-call? .stacks-bank stake u10000000)
```

### Taking a Loan
```clarity
;; First stake collateral
(contract-call? .stacks-bank stake u15000000)
;; Then take loan (max 66.7% of stake)
(contract-call? .stacks-bank take-loan u10000000)
```

### Checking Balances
```clarity
;; Check your stake
(contract-call? .stacks-bank get-stake tx-sender)
;; Check your loan
(contract-call? .stacks-bank get-loan tx-sender)
```

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 100 | ERR-NOT-AUTHORIZED | Unauthorized access |
| 101 | ERR-INSUFFICIENT-FUNDS | Insufficient funds |
| 102 | ERR-INVALID-AMOUNT | Invalid amount |
| 103 | ERR-LOAN-NOT-FOUND | Loan not found |
| 104 | ERR-INSUFFICIENT-COLLATERAL | Insufficient collateral |
| 105 | ERR-LOAN-ALREADY-EXISTS | Loan already exists |
| 106 | ERR-STAKE-NOT-FOUND | Stake not found |
| 107 | ERR-LIQUIDATION-NOT-ALLOWED | Liquidation not allowed |
| 108 | ERR-INVALID-INTEREST-RATE | Invalid interest rate |

## Testing

The contract includes comprehensive tests covering:
- Basic staking and withdrawal functionality
- Loan creation and repayment
- Interest calculations
- Liquidation mechanisms
- Administrative functions
- Multi-user scenarios
- Error conditions

Run tests with:
```bash
clarinet test
```

## Security Considerations

1. **Collateralization**: Loans require 150% collateral ratio
2. **Interest Accrual**: Interest calculated in real-time
3. **Liquidation Protection**: Automated liquidation prevents bad debt
4. **Access Controls**: Admin functions restricted to contract owner
5. **Emergency Pause**: Circuit breaker for emergency situations
6. **Input Validation**: Comprehensive parameter validation

## Development

This contract is built using:
- **Clarity**: Smart contract language for Stacks
- **Clarinet**: Development and testing framework

## License

This project is open source and available under the MIT License. 