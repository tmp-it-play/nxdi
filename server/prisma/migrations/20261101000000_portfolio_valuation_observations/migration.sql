CREATE TABLE `tb_portfolio_valuation_observations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshot_date` VARCHAR(10) NOT NULL,
    `observed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `total_market_value_krw` DOUBLE NOT NULL,
    `cost_basis_krw` DOUBLE NULL,
    `annual_dividend_krw` DOUBLE NULL,

    PRIMARY KEY (`id`),
    INDEX `tb_portfolio_valuation_observations_snapshot_date_id_idx` (`snapshot_date`, `id`),
    CONSTRAINT `tb_portfolio_valuation_observations_snapshot_date_fkey`
        FOREIGN KEY (`snapshot_date`) REFERENCES `tb_portfolio_daily_snapshots` (`snapshotDate`)
        ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
