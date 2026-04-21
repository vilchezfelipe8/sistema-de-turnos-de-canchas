import { AccountService } from './AccountService';

export class AccountItemService {
  private readonly accountService = new AccountService();

  async create(clubId: number, accountId: string, input: {
    description: string;
    quantity: number;
    unitPrice: number;
    type?: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
    productId?: number;
    serviceCode?: string;
    applyDiscount?: boolean;
    actorUserId?: number | null;
  }) {
    return this.accountService.addItem(clubId, accountId, input);
  }
}
