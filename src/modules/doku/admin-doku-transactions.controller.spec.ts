import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminDokuTransactionsController } from './admin-doku-transactions.controller';
import { DokuTransactionsService } from './doku-transactions.service';
import { ListDokuTransactionsDto } from './dto/list-doku-transactions.dto';

const mockTxnView = {
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

const mockTxnDetailView = {
  ...mockTxnView,
  raw_payload: { order: { invoice_number: 'INV-TEST', amount: 300000 } },
};

describe('AdminDokuTransactionsController', () => {
  let controller: AdminDokuTransactionsController;
  let service: jest.Mocked<Pick<DokuTransactionsService, 'findAllForAdmin' | 'findByIdForAdmin'>>;

  beforeEach(async () => {
    service = {
      findAllForAdmin: jest.fn(),
      findByIdForAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminDokuTransactionsController],
      providers: [{ provide: DokuTransactionsService, useValue: service }],
    }).compile();

    controller = module.get(AdminDokuTransactionsController);
  });

  describe('GET /admin/doku-transactions', () => {
    it('delegates to service.findAllForAdmin and returns paginated result', async () => {
      const paginated = { items: [mockTxnView], total: 1, page: 1, limit: 50 };
      service.findAllForAdmin.mockResolvedValue(paginated as any);

      const query: ListDokuTransactionsDto = { callback_status: 'SUCCESS', signature_valid: true };
      const result = await controller.findAll(query);

      expect(service.findAllForAdmin).toHaveBeenCalledWith(query);
      expect(result).toBe(paginated);
    });

    it('passes empty filter when no query params are provided', async () => {
      service.findAllForAdmin.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
      await controller.findAll({});
      expect(service.findAllForAdmin).toHaveBeenCalledWith({});
    });

    it('supports signature_valid=false filter', async () => {
      service.findAllForAdmin.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
      await controller.findAll({ signature_valid: false });
      expect(service.findAllForAdmin).toHaveBeenCalledWith({ signature_valid: false });
    });
  });

  describe('GET /admin/doku-transactions/:id', () => {
    it('returns the detail view including raw_payload', async () => {
      service.findByIdForAdmin.mockResolvedValue(mockTxnDetailView as any);
      const result = await controller.findOne('dtxn-1');
      expect(service.findByIdForAdmin).toHaveBeenCalledWith('dtxn-1');
      expect(result).toBe(mockTxnDetailView);
      expect((result as any).raw_payload).toBeDefined();
    });

    it('propagates NotFoundException when transaction does not exist', async () => {
      service.findByIdForAdmin.mockRejectedValue(new NotFoundException());
      await expect(controller.findOne('no-such-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
