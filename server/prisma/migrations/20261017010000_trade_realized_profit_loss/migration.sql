-- AlterTable
ALTER TABLE `tb_portfolio_trade_executions`
    ADD COLUMN `cost_basis_krw` INTEGER NULL,
    ADD COLUMN `realized_profit_loss_krw` INTEGER NULL,
    ADD COLUMN `realized_fx_gain_loss_krw` INTEGER NULL;
