;; Stacks Bank - A robust DeFi lending and staking protocol
;; Allows users to stake STX tokens to earn interest and take loans against their collateral

;; Error constants
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INSUFFICIENT-FUNDS (err u101))
(define-constant ERR-INVALID-AMOUNT (err u102))
(define-constant ERR-LOAN-NOT-FOUND (err u103))
(define-constant ERR-INSUFFICIENT-COLLATERAL (err u104))
(define-constant ERR-LOAN-ALREADY-EXISTS (err u105))
(define-constant ERR-STAKE-NOT-FOUND (err u106))
(define-constant ERR-LIQUIDATION-NOT-ALLOWED (err u107))
(define-constant ERR-INVALID-INTEREST-RATE (err u108))

;; Contract constants
(define-constant CONTRACT-OWNER tx-sender)
(define-constant MINIMUM-STAKE u1000000) ;; 1 STX minimum stake
(define-constant MINIMUM-LOAN u500000)   ;; 0.5 STX minimum loan
(define-constant LIQUIDATION-THRESHOLD u150) ;; 150% collateralization ratio
(define-constant MAX-INTEREST-RATE u2000) ;; 20% max annual interest rate (in basis points)

;; Data variables
(define-data-var total-staked uint u0)
(define-data-var total-borrowed uint u0)
(define-data-var stake-interest-rate uint u500) ;; 5% annual interest rate (in basis points)
(define-data-var loan-interest-rate uint u800)  ;; 8% annual interest rate (in basis points)
(define-data-var contract-paused bool false)

;; Data maps
(define-map stakes 
  principal 
  {
    amount: uint,
    timestamp: uint,
    last-interest-update: uint
  }
)

(define-map loans 
  principal 
  {
    amount: uint,
    collateral: uint,
    timestamp: uint,
    last-interest-update: uint
  }
)

(define-map accumulated-interest 
  principal 
  {
    stake-interest: uint,
    loan-interest: uint
  }
)

;; Read-only functions

;; Get current stake information for a user
(define-read-only (get-stake (user principal))
  (map-get? stakes user)
)

;; Get current loan information for a user
(define-read-only (get-loan (user principal))
  (map-get? loans user)
)

;; Get accumulated interest for a user
(define-read-only (get-accumulated-interest (user principal))
  (map-get? accumulated-interest user)
)

;; Calculate stake interest earned
(define-read-only (calculate-stake-interest (user principal))
  (match (map-get? stakes user)
    stake-info (let
      (
        (principal-amount (get amount stake-info))
        (time-elapsed (- block-height (get last-interest-update stake-info)))
        (annual-rate (var-get stake-interest-rate))
      )
      ;; Simple interest calculation: principal * rate * time / (365 * 24 * 6 * 10000)
      ;; Assuming ~6 blocks per minute, 1440 minutes per day
      (/ (* (* principal-amount annual-rate) time-elapsed) u31536000) ;; 365 days in basis points
    )
    u0
  )
)

;; Calculate loan interest owed
(define-read-only (calculate-loan-interest (user principal))
  (match (map-get? loans user)
    loan-info (let
      (
        (principal-amount (get amount loan-info))
        (time-elapsed (- block-height (get last-interest-update loan-info)))
        (annual-rate (var-get loan-interest-rate))
      )
      ;; Simple interest calculation for loans
      (/ (* (* principal-amount annual-rate) time-elapsed) u31536000)
    )
    u0
  )
)

;; Calculate total debt including interest
(define-read-only (get-total-debt (user principal))
  (match (map-get? loans user)
    loan-info (let
      (
        (principal-debt (get amount loan-info))
        (interest-debt (calculate-loan-interest user))
        (accumulated (default-to {stake-interest: u0, loan-interest: u0} 
                                (map-get? accumulated-interest user)))
      )
      (+ principal-debt interest-debt (get loan-interest accumulated))
    )
    u0
  )
)

;; Check if a loan is eligible for liquidation
(define-read-only (is-liquidatable (user principal))
  (match (map-get? loans user)
    loan-info (let
      (
        (collateral (get collateral loan-info))
        (total-debt (get-total-debt user))
        (collateral-ratio (if (> total-debt u0) (/ (* collateral u100) total-debt) u0))
      )
      (< collateral-ratio LIQUIDATION-THRESHOLD)
    )
    false
  )
)

;; Get contract statistics
(define-read-only (get-contract-stats)
  {
    total-staked: (var-get total-staked),
    total-borrowed: (var-get total-borrowed),
    stake-rate: (var-get stake-interest-rate),
    loan-rate: (var-get loan-interest-rate),
    paused: (var-get contract-paused)
  }
)

;; Private functions

;; Update accumulated interest for a user
(define-private (update-interest (user principal))
  (let
    (
      (stake-interest (calculate-stake-interest user))
      (loan-interest (calculate-loan-interest user))
      (current-accumulated (default-to {stake-interest: u0, loan-interest: u0} 
                                       (map-get? accumulated-interest user)))
    )
    (map-set accumulated-interest user
      {
        stake-interest: (+ (get stake-interest current-accumulated) stake-interest),
        loan-interest: (+ (get loan-interest current-accumulated) loan-interest)
      }
    )
    ;; Update timestamps
    (match (map-get? stakes user)
      stake-info (map-set stakes user (merge stake-info {last-interest-update: block-height}))
      true
    )
    (match (map-get? loans user)
      loan-info (map-set loans user (merge loan-info {last-interest-update: block-height}))
      true
    )
  )
)

;; Public functions

;; Stake STX tokens to earn interest
(define-public (stake (amount uint))
  (let
    (
      (caller tx-sender)
      (current-stake (map-get? stakes caller))
    )
    (asserts! (not (var-get contract-paused)) ERR-NOT-AUTHORIZED)
    (asserts! (>= amount MINIMUM-STAKE) ERR-INVALID-AMOUNT)
    
    ;; Transfer STX to contract
    (try! (stx-transfer? amount caller (as-contract tx-sender)))
    
    ;; Update interest before modifying stake
    (update-interest caller)
    
    ;; Update or create stake record
    (match current-stake
      existing-stake (map-set stakes caller
        {
          amount: (+ (get amount existing-stake) amount),
          timestamp: (get timestamp existing-stake),
          last-interest-update: block-height
        }
      )
      (map-set stakes caller
        {
          amount: amount,
          timestamp: block-height,
          last-interest-update: block-height
        }
      )
    )
    
    ;; Update total staked
    (var-set total-staked (+ (var-get total-staked) amount))
    
    (ok amount)
  )
)

;; Withdraw staked STX tokens (with earned interest)
(define-public (withdraw-stake (amount uint))
  (let
    (
      (caller tx-sender)
      (stake-info (unwrap! (map-get? stakes caller) ERR-STAKE-NOT-FOUND))
      (stake-interest (calculate-stake-interest caller))
      (accumulated (default-to {stake-interest: u0, loan-interest: u0} 
                              (map-get? accumulated-interest caller)))
      (total-available (+ (get amount stake-info) stake-interest (get stake-interest accumulated)))
    )
    (asserts! (not (var-get contract-paused)) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= total-available amount) ERR-INSUFFICIENT-FUNDS)
    
    ;; Update interest
    (update-interest caller)
    
    ;; Calculate remaining stake after withdrawal
    (let ((remaining-stake (- (get amount stake-info) amount)))
      ;; Update stake record
      (if (> remaining-stake u0)
        (map-set stakes caller
          {
            amount: remaining-stake,
            timestamp: (get timestamp stake-info),
            last-interest-update: block-height
          }
        )
        (map-delete stakes caller)
      )
    )
    
    ;; Transfer STX back to user
    (try! (as-contract (stx-transfer? amount tx-sender caller)))
    
    ;; Update total staked
    (var-set total-staked (- (var-get total-staked) amount))
    
    (ok amount)
  )
)

;; Take a loan against staked collateral
(define-public (take-loan (amount uint))
  (let
    (
      (caller tx-sender)
      (stake-info (unwrap! (map-get? stakes caller) ERR-STAKE-NOT-FOUND))
      (existing-loan (map-get? loans caller))
      (collateral-amount (get amount stake-info))
      (max-loan (/ (* collateral-amount u100) LIQUIDATION-THRESHOLD))
    )
    (asserts! (not (var-get contract-paused)) ERR-NOT-AUTHORIZED)
    (asserts! (>= amount MINIMUM-LOAN) ERR-INVALID-AMOUNT)
    (asserts! (is-none existing-loan) ERR-LOAN-ALREADY-EXISTS)
    (asserts! (<= amount max-loan) ERR-INSUFFICIENT-COLLATERAL)
    
    ;; Update interest
    (update-interest caller)
    
    ;; Create loan record
    (map-set loans caller
      {
        amount: amount,
        collateral: collateral-amount,
        timestamp: block-height,
        last-interest-update: block-height
      }
    )
    
    ;; Transfer loan amount to user
    (try! (as-contract (stx-transfer? amount tx-sender caller)))
    
    ;; Update total borrowed
    (var-set total-borrowed (+ (var-get total-borrowed) amount))
    
    (ok amount)
  )
)

;; Repay loan (partial or full)
(define-public (repay-loan (amount uint))
  (let
    (
      (caller tx-sender)
      (loan-info (unwrap! (map-get? loans caller) ERR-LOAN-NOT-FOUND))
      (total-debt (get-total-debt caller))
    )
    (asserts! (not (var-get contract-paused)) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (<= amount total-debt) ERR-INVALID-AMOUNT)
    
    ;; Transfer repayment to contract
    (try! (stx-transfer? amount caller (as-contract tx-sender)))
    
    ;; Update interest
    (update-interest caller)
    
    ;; Calculate remaining debt
    (let ((remaining-debt (- (get amount loan-info) amount)))
      (if (> remaining-debt u0)
        ;; Partial repayment
        (map-set loans caller (merge loan-info {amount: remaining-debt}))
        ;; Full repayment - delete loan
        (map-delete loans caller)
      )
    )
    
    ;; Update total borrowed
    (var-set total-borrowed (- (var-get total-borrowed) amount))
    
    (ok amount)
  )
)

;; Liquidate an under-collateralized loan
(define-public (liquidate (borrower principal))
  (let
    (
      (loan-info (unwrap! (map-get? loans borrower) ERR-LOAN-NOT-FOUND))
      (stake-info (unwrap! (map-get? stakes borrower) ERR-STAKE-NOT-FOUND))
      (total-debt (get-total-debt borrower))
      (collateral (get collateral loan-info))
    )
    (asserts! (not (var-get contract-paused)) ERR-NOT-AUTHORIZED)
    (asserts! (is-liquidatable borrower) ERR-LIQUIDATION-NOT-ALLOWED)
    
    ;; Transfer debt amount from liquidator to contract
    (try! (stx-transfer? total-debt tx-sender (as-contract tx-sender)))
    
    ;; Transfer collateral from contract to liquidator
    (try! (as-contract (stx-transfer? collateral tx-sender tx-sender)))
    
    ;; Clear borrower's loan and stake
    (map-delete loans borrower)
    (map-delete stakes borrower)
    (map-delete accumulated-interest borrower)
    
    ;; Update totals
    (var-set total-borrowed (- (var-get total-borrowed) (get amount loan-info)))
    (var-set total-staked (- (var-get total-staked) collateral))
    
    (ok collateral)
  )
)

;; Admin functions

;; Set stake interest rate (only contract owner)
(define-public (set-stake-interest-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (<= new-rate MAX-INTEREST-RATE) ERR-INVALID-INTEREST-RATE)
    (var-set stake-interest-rate new-rate)
    (ok new-rate)
  )
)

;; Set loan interest rate (only contract owner)
(define-public (set-loan-interest-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (<= new-rate MAX-INTEREST-RATE) ERR-INVALID-INTEREST-RATE)
    (var-set loan-interest-rate new-rate)
    (ok new-rate)
  )
)

;; Pause/unpause contract (only contract owner)
(define-public (toggle-contract-pause)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set contract-paused (not (var-get contract-paused)))
    (ok (var-get contract-paused))
  )
)

;; Emergency withdraw (only contract owner, when paused)
(define-public (emergency-withdraw (amount uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (var-get contract-paused) ERR-NOT-AUTHORIZED)
    (try! (as-contract (stx-transfer? amount tx-sender CONTRACT-OWNER)))
    (ok amount)
  )
)
