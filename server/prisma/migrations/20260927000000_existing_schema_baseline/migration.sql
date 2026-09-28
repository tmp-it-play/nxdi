-- CreateTable
CREATE TABLE `tb_portfolio_holdings` (
    `symbol` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(80) NULL,
    `marketCountry` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `lastPrice` DOUBLE NOT NULL,
    `averagePurchasePrice` DOUBLE NULL,
    `purchaseExchangeRate` DOUBLE NULL,
    `profitLossRate` DOUBLE NULL,
    `risk_level` ENUM('LOW', 'HIGH') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`symbol`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_portfolio_daily_snapshots` (
    `snapshotDate` VARCHAR(10) NOT NULL,
    `totalMarketValueKrw` DOUBLE NOT NULL,
    `exchangeRate` DOUBLE NOT NULL,
    `costBasisKrw` DOUBLE NULL,
    `annualDividendKrw` DOUBLE NULL,
    `closeTotalMarketValueKrw` DOUBLE NULL,
    `closeExchangeRate` DOUBLE NULL,
    `closeCostBasisKrw` DOUBLE NULL,
    `closeAnnualDividendKrw` DOUBLE NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tb_portfolio_daily_snapshots_updatedAt_idx`(`updatedAt`),
    INDEX `tb_portfolio_daily_snapshots_snapshotDate_closedAt_idx`(`snapshotDate`, `closedAt`),
    PRIMARY KEY (`snapshotDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_dividend_records` (
    `symbol` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `annualDividendPerShare` DOUBLE NOT NULL,
    `trailingYield` DOUBLE NULL,
    `expectedPaymentMonths` VARCHAR(80) NOT NULL,
    `lastDividendPerShare` DOUBLE NULL,
    `memo` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`symbol`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_monthly_dividend_records` (
    `dividend_month` VARCHAR(7) NOT NULL,
    `record_id` VARCHAR(36) NOT NULL,
    `actual_dividend_krw` INTEGER NOT NULL,
    `reference_market_value_krw` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_monthly_dividend_records_record_id`(`record_id`),
    INDEX `idx_monthly_dividend_records_updated_at`(`updated_at`),
    PRIMARY KEY (`dividend_month`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_disclosures` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tb_disclosures_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_roadmap_events` (
    `id` VARCHAR(191) NOT NULL,
    `disclosure_id` VARCHAR(191) NOT NULL,
    `event_date` VARCHAR(10) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    `category` VARCHAR(24) NOT NULL DEFAULT 'OTHER',
    `label` VARCHAR(160) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_roadmap_events_event_date`(`event_date`),
    INDEX `idx_roadmap_events_disclosure_id`(`disclosure_id`),
    UNIQUE INDEX `uq_roadmap_events_disclosure_date`(`disclosure_id`, `event_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_disclosure_trades` (
    `id` VARCHAR(191) NOT NULL,
    `disclosureId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(80) NULL,
    `marketCountry` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `orderPrice` DOUBLE NOT NULL,
    `exchangeRate` DOUBLE NULL,
    `profitRate` DOUBLE NOT NULL,
    `feeKrw` INTEGER NOT NULL DEFAULT 0,
    `taxKrw` INTEGER NOT NULL DEFAULT 0,
    `orderedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tb_disclosure_trades_disclosureId_idx`(`disclosureId`),
    INDEX `tb_disclosure_trades_symbol_idx`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_investment_intents` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `amountKrw` INTEGER NOT NULL,
    `depositorName` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `guardianConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `dividendPolicyAgreed` BOOLEAN NOT NULL DEFAULT false,
    `product_document_version` VARCHAR(32) NULL,
    `product_document_hash` CHAR(64) NULL,
    `dividend_policy_version` VARCHAR(32) NULL,
    `dividend_policy_hash` CHAR(64) NULL,
    `agreed_at` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tb_investment_intents_userId_idx`(`userId`),
    INDEX `tb_investment_intents_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_withdrawal_intents` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `amountKrw` INTEGER NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `accountNumber` VARCHAR(255) NOT NULL,
    `accountHolder` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `product_document_version` VARCHAR(32) NULL,
    `product_document_hash` CHAR(64) NULL,
    `agreed_at` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tb_withdrawal_intents_userId_idx`(`userId`),
    INDEX `tb_withdrawal_intents_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_portfolio_trade_executions` (
    `id` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `side` VARCHAR(8) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `order_price` DOUBLE NOT NULL,
    `exchange_rate` DOUBLE NULL,
    `gross_amount_krw` INTEGER NOT NULL,
    `fee_krw` INTEGER NOT NULL DEFAULT 0,
    `tax_krw` INTEGER NOT NULL DEFAULT 0,
    `cash_amount_krw` INTEGER NOT NULL,
    `executed_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_trade_executions_symbol_time`(`symbol`, `executed_at`),
    INDEX `idx_trade_executions_time`(`executed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_roadmap_events` ADD CONSTRAINT `tb_roadmap_events_disclosure_id_fkey` FOREIGN KEY (`disclosure_id`) REFERENCES `tb_disclosures`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_disclosure_trades` ADD CONSTRAINT `tb_disclosure_trades_disclosureId_fkey` FOREIGN KEY (`disclosureId`) REFERENCES `tb_disclosures`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
