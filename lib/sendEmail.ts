import { sendOrderEmail } from "@/lib/sendEmail"; // or "../../lib/sendEmail"

let email = { success: false, id: null as string | null, error: null as string | null };
try {
  const to = (payload?.customer?.email as string) || process.env.SES_FALLBACK_TO!;
  if (to && process.env.SES_FROM) {
    const r = await sendOrderEmail({ to, orderId, lines, subtotal, tax, total, when, ftype });
    email = { success: true, id: (r as any)?.MessageId || null, error: null };
  } else {
    email = { success: false, id: null, error: "not_configured" };
  }
} catch (e: any) {
  email = { success: false, id: null, error: e?.message || "email_error" };
}

// include `email` in your JSON response
