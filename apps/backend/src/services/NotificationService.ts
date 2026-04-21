import { prisma } from '../prisma';

export class NotificationService {
  async createNotification(
    userId: number | null | undefined,
    clubId: number,
    title: string,
    message: string
  ) {
    return prisma.notification.create({
      data: {
        userId: userId ?? null,
        clubId,
        title,
        message,
        channel: 'IN_APP',
        status: 'CREATED',
        isRead: false
      }
    });
  }
}
