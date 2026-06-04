/**

 * Bridge campaign SMS to existing BullMQ notification SMS queue.

 */

import { enqueueSmsJob, type NotificationJobPayload } from "../../services/notificationQueue";



export async function enqueueCampaignSmsMessage(

  phone: string,

  message: string,

  meta?: { template?: string; campaignSmsLogId?: number; bookingId?: number }

): Promise<boolean> {

  const payload: NotificationJobPayload = {

    notificationId: 0,

    userId: 0,

    channel: "SMS",

    toAddress: phone,

    type: meta?.template || "CAMPAIGN_SMS",

    title: "BPA Vaccination Campaign",

    message,

    meta: {

      ...(meta ?? {}),

      useRawMessage: true,

    },

  };



  return enqueueSmsJob(payload);
}


