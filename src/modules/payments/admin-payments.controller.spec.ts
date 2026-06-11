import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';
import { DokuTransactionsService } from '../doku/doku-transactions.service';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { PaymentStatus } from './entities/payment.entity';

const mockPaymentView = {
  id: 'pay-1',
  payment_code: 'INV-TEST',
  member: { id: 'mem-1', first_name: 'Alice', last_name: 'Tan', email: 'alice@test.com' },
  package: { id: 'pkg-1', name: 'Starter Pack' },
  amount_idr: 300000,
  method: 'VIRTUAL_ACCOUNT_BCA',
  gateway: 'doku',
  status: PaymentStatus.PAID,
  external_reference: 'tok-abc',
  paid_at: new Date('2026-06-11T11:31:18Z'),
  expired_at: null,
  created_at: new Date('2026-06-11T10:00:00Z'),
  updated_at: new Date('2026-06-11T11:31:18Z'),
};

const mockPaymentDetailView = { ...mockPaymentView, checkout_url: 'https://staging.doku.com/abc' };

const mockDokuTxnView = {
  id: 'dtxn-1',
  payment_id: 'pay-1',
  order_id: 'INV-TEST',
  doku_reference: 'ref-xyz',
  callback_status: 'SUCCESS',
  signature_valid: true,
  amount_idr: 300000,
  method: 'VIRTUAL_ACCOUNT_BCA',
  transaction_date: new Date('2026-06-11T11:31:00Z'),
  received_at: new Date('2026-06-11T11:31:05Z'),
  reconciled_at: new Date('2026-06-11T11:31:06Z'),
};

describe('AdminPaymentsController', () => {
  let controller: AdminPaymentsController;
  let paymentsService: jest.Mocked<Pick<PaymentsService, 'findAllForAdmin' | 'findByIdForAdmin'>>;
  let dokuTransactions: jest.Mocked<Pick<DokuTransactionsService, 'findByPaymentIdForAdmin'>>;

  beforeEach(async () => {
    paymentsService = {
      findAllForAdmin: jest.fn(),
      findByIdForAdmin: jest.fn(),
    };
    dokuTransactions = {
      findByPaymentIdForAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminPaymentsController],
      providers: [
        { provide: PaymentsService, useValue: paymentsService },
        { provide: DokuTransactionsService, useValue: dokuTransactions },
      ],
    }).compile();

    controller = module.get(AdminPaymentsController);
  });

  describe('GET /admin/payments', () => {
    it('delegates to paymentsService.findAllForAdmin and returns paginated result', async () => {
      const paginated = { items: [mockPaymentView], total: 1, page: 1, limit: 20 };
      paymentsService.findAllForAdmin.mockResolvedValue(paginated as any);

      const query: ListPaymentsDto = { status: PaymentStatus.PAID };
      const result = await controller.findAll(query);

      expect(paymentsService.findAllForAdmin).toHaveBeenCalledWith(query);
      expect(result).toBe(paginated);
    });

    it('passes empty filter when no query params are provided', async () => {
      paymentsService.findAllForAdmin.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      await controller.findAll({});
      expect(paymentsService.findAllForAdmin).toHaveBeenCalledWith({});
    });
  });

  describe('GET /admin/payments/:id', () => {
    it('returns the payment detail view', async () => {
      paymentsService.findByIdForAdmin.mockResolvedValue(mockPaymentDetailView as any);
      const result = await controller.findOne('pay-1');
      expect(paymentsService.findByIdForAdmin).toHaveBeenCalledWith('pay-1');
      expect(result).toBe(mockPaymentDetailView);
    });

    it('propagates NotFoundException when payment does not exist', async () => {
      paymentsService.findByIdForAdmin.mockRejectedValue(
        new NotFoundException('Payment not found'),
      );
      await expect(controller.findOne('no-such-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('GET /admin/payments/:id/doku-transactions', () => {
    it('returns doku transactions for the payment', async () => {
      paymentsService.findByIdForAdmin.mockResolvedValue(mockPaymentDetailView as any);
      dokuTransactions.findByPaymentIdForAdmin.mockResolvedValue([mockDokuTxnView] as any);

      const result = await controller.findDokuTransactions('pay-1');

      expect(paymentsService.findByIdForAdmin).toHaveBeenCalledWith('pay-1');
      expect(dokuTransactions.findByPaymentIdForAdmin).toHaveBeenCalledWith('pay-1');
      expect(result).toEqual([mockDokuTxnView]);
    });

    it('throws 404 without querying doku-transactions when payment does not exist', async () => {
      paymentsService.findByIdForAdmin.mockRejectedValue(new NotFoundException());
      await expect(controller.findDokuTransactions('bad-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(dokuTransactions.findByPaymentIdForAdmin).not.toHaveBeenCalled();
    });
  });
});
