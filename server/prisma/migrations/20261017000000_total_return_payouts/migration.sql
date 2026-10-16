-- CreateTable
CREATE TABLE `tb_investor_payout_preferences` (
    `user_id` VARCHAR(191) NOT NULL,
    `payout_mode` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_monthly_investor_payouts` (
    `dividend_month` VARCHAR(7) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `payout_mode` VARCHAR(20) NOT NULL,
    `eligible_principal_krw` INTEGER NOT NULL,
    `cash_payout_krw` INTEGER NOT NULL,
    `total_return_accrual_krw` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_monthly_investor_payouts_user_id`(`user_id`),
    PRIMARY KEY (`dividend_month`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
