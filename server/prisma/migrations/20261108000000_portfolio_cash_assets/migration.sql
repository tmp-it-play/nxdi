CREATE TABLE `tb_portfolio_cash_assets` (
    `currency` VARCHAR(3) NOT NULL,
    `balance` DECIMAL(18,2) NOT NULL,
    `initial_balance` DECIMAL(18,2) NOT NULL,
    `initial_cost_basis_krw` DECIMAL(18,2) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`currency`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tb_portfolio_daily_snapshots`
    ADD COLUMN `cash_balance_krw` DOUBLE NULL,
    ADD COLUMN `cash_balance_usd` DOUBLE NULL,
    ADD COLUMN `cash_market_value_krw` DOUBLE NULL,
    ADD COLUMN `cash_cost_basis_krw` DOUBLE NULL,
    ADD COLUMN `close_cash_balance_krw` DOUBLE NULL,
    ADD COLUMN `close_cash_balance_usd` DOUBLE NULL,
    ADD COLUMN `close_cash_market_value_krw` DOUBLE NULL,
    ADD COLUMN `close_cash_cost_basis_krw` DOUBLE NULL;

ALTER TABLE `tb_portfolio_valuation_observations`
    ADD COLUMN `cash_balance_krw` DOUBLE NULL,
    ADD COLUMN `cash_balance_usd` DOUBLE NULL,
    ADD COLUMN `cash_market_value_krw` DOUBLE NULL,
    ADD COLUMN `cash_cost_basis_krw` DOUBLE NULL,
    ADD COLUMN `exchange_rate` DOUBLE NULL;
