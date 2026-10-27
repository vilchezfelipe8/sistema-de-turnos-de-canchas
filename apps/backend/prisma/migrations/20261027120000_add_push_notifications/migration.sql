-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSentAt" TIMESTAMPTZ(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "userId" INTEGER NOT NULL,
    "invitations" BOOLEAN NOT NULL DEFAULT true,
    "invitationResponses" BOOLEAN NOT NULL DEFAULT true,
    "bookingReminders" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BookingReminderLog" (
    "bookingId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingReminderLog_pkey" PRIMARY KEY ("bookingId","userId","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReminderLog" ADD CONSTRAINT "BookingReminderLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReminderLog" ADD CONSTRAINT "BookingReminderLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

