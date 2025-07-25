import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
    name: "Ensure contract initialization is correct",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        
        let block = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-contract-stats', [], deployer.address)
        ]);
        
        block.receipts[0].result.expectOk().expectTuple()["total-staked"].expectUint(0);
        block.receipts[0].result.expectOk().expectTuple()["total-borrowed"].expectUint(0);
        block.receipts[0].result.expectOk().expectTuple()["stake-rate"].expectUint(500); // 5%
        block.receipts[0].result.expectOk().expectTuple()["loan-rate"].expectUint(800); // 8%
        block.receipts[0].result.expectOk().expectTuple()["paused"].expectBool(false);
    },
});

Clarinet.test({
    name: "User can stake STX tokens successfully",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const stakeAmount = 5000000; // 5 STX
        
        let block = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address)
        ]);
        
        block.receipts[0].result.expectOk().expectUint(stakeAmount);
        
        // Check stake was recorded
        let stakeCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-stake', [types.principal(wallet1.address)], deployer.address)
        ]);
        
        stakeCheck.receipts[0].result.expectSome().expectTuple()["amount"].expectUint(stakeAmount);
    },
});

Clarinet.test({
    name: "Staking fails with insufficient amount",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;
        const tooSmallAmount = 500000; // 0.5 STX (below minimum)
        
        let block = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(tooSmallAmount)], wallet1.address)
        ]);
        
        block.receipts[0].result.expectErr().expectUint(102); // ERR-INVALID-AMOUNT
    },
});

Clarinet.test({
    name: "User can take a loan against staked collateral",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const stakeAmount = 10000000; // 10 STX
        const loanAmount = 6000000;   // 6 STX (60% of stake, under 150% threshold)
        
        // First stake
        let stakeBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address)
        ]);
        stakeBlock.receipts[0].result.expectOk();
        
        // Then take loan
        let loanBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'take-loan', [types.uint(loanAmount)], wallet1.address)
        ]);
        loanBlock.receipts[0].result.expectOk().expectUint(loanAmount);
        
        // Check loan was recorded
        let loanCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-loan', [types.principal(wallet1.address)], deployer.address)
        ]);
        
        loanCheck.receipts[0].result.expectSome().expectTuple()["amount"].expectUint(loanAmount);
        loanCheck.receipts[0].result.expectSome().expectTuple()["collateral"].expectUint(stakeAmount);
    },
});

Clarinet.test({
    name: "Loan fails with insufficient collateral",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;
        const stakeAmount = 10000000; // 10 STX
        const tooLargeLoan = 8000000; // 8 STX (80% of stake, exceeds 150% requirement)
        
        // First stake
        let stakeBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address)
        ]);
        stakeBlock.receipts[0].result.expectOk();
        
        // Try to take oversized loan
        let loanBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'take-loan', [types.uint(tooLargeLoan)], wallet1.address)
        ]);
        loanBlock.receipts[0].result.expectErr().expectUint(104); // ERR-INSUFFICIENT-COLLATERAL
    },
});

Clarinet.test({
    name: "User can repay loan partially and fully",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const stakeAmount = 10000000; // 10 STX
        const loanAmount = 5000000;   // 5 STX
        const partialRepay = 2000000; // 2 STX
        
        // Stake and take loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address),
            Tx.contractCall('stacks-bank', 'take-loan', [types.uint(loanAmount)], wallet1.address)
        ]);
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Partial repayment
        let partialRepayBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'repay-loan', [types.uint(partialRepay)], wallet1.address)
        ]);
        partialRepayBlock.receipts[0].result.expectOk();
        
        // Check remaining loan
        let loanCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-loan', [types.principal(wallet1.address)], deployer.address)
        ]);
        loanCheck.receipts[0].result.expectSome().expectTuple()["amount"].expectUint(loanAmount - partialRepay);
        
        // Full repayment
        let fullRepayBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'repay-loan', [types.uint(loanAmount - partialRepay)], wallet1.address)
        ]);
        fullRepayBlock.receipts[0].result.expectOk();
        
        // Check loan is cleared
        let finalCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-loan', [types.principal(wallet1.address)], deployer.address)
        ]);
        finalCheck.receipts[0].result.expectNone();
    },
});

Clarinet.test({
    name: "User can withdraw staked funds",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const stakeAmount = 5000000; // 5 STX
        const withdrawAmount = 3000000; // 3 STX
        
        // Stake funds
        let stakeBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address)
        ]);
        stakeBlock.receipts[0].result.expectOk();
        
        // Withdraw partial amount
        let withdrawBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'withdraw-stake', [types.uint(withdrawAmount)], wallet1.address)
        ]);
        withdrawBlock.receipts[0].result.expectOk();
        
        // Check remaining stake
        let stakeCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-stake', [types.principal(wallet1.address)], deployer.address)
        ]);
        stakeCheck.receipts[0].result.expectSome().expectTuple()["amount"].expectUint(stakeAmount - withdrawAmount);
    },
});

Clarinet.test({
    name: "Interest calculations work correctly",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const stakeAmount = 10000000; // 10 STX
        
        // Stake funds
        let stakeBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address)
        ]);
        stakeBlock.receipts[0].result.expectOk();
        
        // Mine some blocks to simulate time passing
        chain.mineEmptyBlockUntil(150);
        
        // Check stake interest calculation
        let interestCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'calculate-stake-interest', [types.principal(wallet1.address)], deployer.address)
        ]);
        
        // Interest should be greater than 0 after blocks have passed
        const interest = interestCheck.receipts[0].result.expectUint();
        assertEquals(interest > 0, true);
    },
});

Clarinet.test({
    name: "Liquidation works for under-collateralized loans",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;
        const stakeAmount = 10000000; // 10 STX
        const loanAmount = 6000000;   // 6 STX
        
        // Setup: stake and take loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(stakeAmount)], wallet1.address),
            Tx.contractCall('stacks-bank', 'take-loan', [types.uint(loanAmount)], wallet1.address)
        ]);
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Mine blocks to accumulate interest and make loan under-collateralized
        chain.mineEmptyBlockUntil(1000);
        
        // Check if liquidatable
        let liquidationCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'is-liquidatable', [types.principal(wallet1.address)], deployer.address)
        ]);
        
        // If liquidatable, wallet2 can liquidate
        if (liquidationCheck.receipts[0].result.expectBool() === true) {
            let liquidateBlock = chain.mineBlock([
                Tx.contractCall('stacks-bank', 'liquidate', [types.principal(wallet1.address)], wallet2.address)
            ]);
            liquidateBlock.receipts[0].result.expectOk();
            
            // Check that loan and stake are cleared
            let finalCheck = chain.mineBlock([
                Tx.contractCall('stacks-bank', 'get-loan', [types.principal(wallet1.address)], deployer.address),
                Tx.contractCall('stacks-bank', 'get-stake', [types.principal(wallet1.address)], deployer.address)
            ]);
            finalCheck.receipts[0].result.expectNone();
            finalCheck.receipts[1].result.expectNone();
        }
    },
});

Clarinet.test({
    name: "Admin functions work correctly",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const newStakeRate = 600; // 6%
        const newLoanRate = 900;  // 9%
        
        // Deployer can set rates
        let rateBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'set-stake-interest-rate', [types.uint(newStakeRate)], deployer.address),
            Tx.contractCall('stacks-bank', 'set-loan-interest-rate', [types.uint(newLoanRate)], deployer.address)
        ]);
        rateBlock.receipts[0].result.expectOk().expectUint(newStakeRate);
        rateBlock.receipts[1].result.expectOk().expectUint(newLoanRate);
        
        // Non-deployer cannot set rates
        let unauthorizedBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'set-stake-interest-rate', [types.uint(700)], wallet1.address)
        ]);
        unauthorizedBlock.receipts[0].result.expectErr().expectUint(100); // ERR-NOT-AUTHORIZED
        
        // Deployer can pause contract
        let pauseBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'toggle-contract-pause', [], deployer.address)
        ]);
        pauseBlock.receipts[0].result.expectOk().expectBool(true);
        
        // Operations should fail when paused
        let failedStake = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(5000000)], wallet1.address)
        ]);
        failedStake.receipts[0].result.expectErr().expectUint(100); // ERR-NOT-AUTHORIZED
    },
});

Clarinet.test({
    name: "Multiple users can interact simultaneously",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;
        const wallet3 = accounts.get('wallet_3')!;
        
        // Multiple users stake simultaneously
        let stakeBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'stake', [types.uint(5000000)], wallet1.address),
            Tx.contractCall('stacks-bank', 'stake', [types.uint(7000000)], wallet2.address),
            Tx.contractCall('stacks-bank', 'stake', [types.uint(3000000)], wallet3.address)
        ]);
        
        stakeBlock.receipts[0].result.expectOk();
        stakeBlock.receipts[1].result.expectOk();
        stakeBlock.receipts[2].result.expectOk();
        
        // Check total staked
        let statsCheck = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-contract-stats', [], deployer.address)
        ]);
        
        statsCheck.receipts[0].result.expectOk().expectTuple()["total-staked"].expectUint(15000000);
        
        // Users can take loans
        let loanBlock = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'take-loan', [types.uint(3000000)], wallet1.address),
            Tx.contractCall('stacks-bank', 'take-loan', [types.uint(4000000)], wallet2.address)
        ]);
        
        loanBlock.receipts[0].result.expectOk();
        loanBlock.receipts[1].result.expectOk();
        
        // Check total borrowed
        let finalStats = chain.mineBlock([
            Tx.contractCall('stacks-bank', 'get-contract-stats', [], deployer.address)
        ]);
        
        finalStats.receipts[0].result.expectOk().expectTuple()["total-borrowed"].expectUint(7000000);
    },
});
