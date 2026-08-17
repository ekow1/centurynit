/**
 * Century NIT — Professional Email Design System
 *
 * Responsive, bulletproof HTML email templates with clean brand styling:
 * Deep Navy (#0f172a), Century Gold/Amber (#d97706), modern typography,
 * high-contrast buttons, and graceful fallbacks across all email clients.
 */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Base email wrapper layout */
function emailLayout({
	title,
	preheader,
	bodyHtml,
	footerNote,
}: {
	title: string;
	preheader?: string;
	bodyHtml: string;
	footerNote?: string;
}): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
	<!--[if mso]>
	<style type="text/css">
		body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
	</style>
	<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1e293b;">
	${preheader ? `<div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>` : ""}
	
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:32px 16px;">
		<tr>
			<td align="center">
				<!-- Main Container -->
				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06);border:1px solid #e2e8f0;">
					
					<!-- Header Banner -->
					<tr>
						<td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 36px;text-align:left;border-bottom:3px solid #d97706;">
							<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
								<tr>
									<td>
										<div style="display:inline-block;padding:4px 10px;background:rgba(217,119,6,0.15);border-radius:6px;border:1px solid rgba(217,119,6,0.3);margin-bottom:8px;">
											<span style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Century NIT</span>
										</div>
										<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;">
											${escapeHtml(title)}
										</h1>
									</td>
								</tr>
							</table>
						</td>
					</tr>

					<!-- Content Body -->
					<tr>
						<td style="padding:36px 36px 28px 36px;font-size:15px;line-height:1.65;color:#334155;">
							${bodyHtml}
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color:#f8fafc;padding:24px 36px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;line-height:1.6;color:#64748b;">
							${footerNote ? `<p style="margin:0 0 8px 0;color:#94a3b8;">${footerNote}</p>` : ""}
							<p style="margin:0;font-weight:600;color:#475569;">
								Century NIT Consult &bull; Study Abroad &amp; Immigration Operations
							</p>
							<p style="margin:4px 0 0 0;color:#94a3b8;">
								Accra, Ghana &bull; London, UK &bull; support@centurynit.com
							</p>
						</td>
					</tr>

				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}

/* ── 1. Staff Invitation Email Template ──────────────────────────────────── */

export function renderInvitationEmail(data: {
	name: string;
	inviterName: string;
	role: string;
	branch?: string | null;
	acceptUrl: string;
	expiresDays: number;
}): { html: string; text: string } {
	const safeName = escapeHtml(data.name.trim());
	const safeInviter = escapeHtml(data.inviterName.trim());
	const safeRole = escapeHtml(data.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
	const safeBranch = data.branch ? escapeHtml(data.branch.toUpperCase()) : null;

	const bodyHtml = `
		<p style="margin:0 0 18px 0;font-size:16px;color:#0f172a;">
			Hello <strong>${safeName}</strong>,
		</p>
		
		<p style="margin:0 0 20px 0;color:#334155;">
			<strong>${safeInviter}</strong> has invited you to join the <strong>Century NIT Operations Center</strong> as a staff member.
		</p>

		<!-- Role & Assignment Badge Card -->
		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;background-color:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:16px 20px;">
			<tr>
				<td>
					<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
						<tr>
							<td style="padding:4px 0;font-size:13px;color:#64748b;width:110px;">Assigned Role:</td>
							<td style="padding:4px 0;font-size:14px;font-weight:700;color:#0f172a;">${safeRole}</td>
						</tr>
						${safeBranch ? `
						<tr>
							<td style="padding:4px 0;font-size:13px;color:#64748b;">Branch:</td>
							<td style="padding:4px 0;font-size:14px;font-weight:600;color:#0f172a;">${safeBranch} Branch</td>
						</tr>` : ""}
						<tr>
							<td style="padding:4px 0;font-size:13px;color:#64748b;">Link Validity:</td>
							<td style="padding:4px 0;font-size:13px;color:#d97706;font-weight:600;">${data.expiresDays} days (single use)</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>

		<p style="margin:0 0 24px 0;color:#334155;">
			Please click the button below to accept your invitation, create your password, and access the platform:
		</p>

		<!-- Action Button -->
		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;">
			<tr>
				<td align="center" style="border-radius:8px;background-color:#0f172a;">
					<a href="${data.acceptUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:1px solid #334155;">
						Accept Invitation &amp; Set Password &rarr;
					</a>
				</td>
			</tr>
		</table>

		<!-- Plaintext link box fallback -->
		<div style="padding:14px 18px;background-color:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1;font-size:12px;color:#64748b;word-break:break-all;">
			<p style="margin:0 0 6px 0;font-weight:600;color:#475569;">Button not working? Paste this link into your browser:</p>
			<a href="${data.acceptUrl}" style="color:#2563eb;text-decoration:underline;">${data.acceptUrl}</a>
		</div>
	`;

	const text = [
		`Hello ${data.name.trim()},`,
		``,
		`${data.inviterName.trim()} has invited you to join the Century NIT Operations Center as ${data.role.replace(/_/g, " ")}${data.branch ? ` (${data.branch.toUpperCase()})` : ""}.`,
		``,
		`Accept your invitation and set your password:`,
		data.acceptUrl,
		``,
		`This invitation link expires in ${data.expiresDays} days and can only be used once.`,
		``,
		`Century NIT Consult Operations Team`,
	].join("\n");

	return {
		html: emailLayout({
			title: "Staff Invitation · Century NIT Operations",
			preheader: `${data.inviterName} has invited you to join Century NIT Operations as ${data.role.replace(/_/g, " ")}`,
			bodyHtml,
			footerNote: "This invitation was sent to your email address by an authorized administrator.",
		}),
		text,
	};
}

/* ── 2. Password Reset Email Template ────────────────────────────────────── */

export function renderPasswordResetEmail(data: {
	name?: string;
	resetUrl: string;
}): { html: string; text: string } {
	const greeting = data.name ? `Hello <strong>${escapeHtml(data.name)}</strong>,` : `Hello,`;

	const bodyHtml = `
		<p style="margin:0 0 16px 0;font-size:16px;color:#0f172a;">${greeting}</p>
		<p style="margin:0 0 20px 0;color:#334155;">
			We received a request to reset your password for your Century NIT account. Click the button below to choose a new password:
		</p>

		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;">
			<tr>
				<td align="center" style="border-radius:8px;background-color:#0f172a;">
					<a href="${data.resetUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;background:#0f172a;">
						Reset Password &rarr;
					</a>
				</td>
			</tr>
		</table>

		<div style="padding:14px 18px;background-color:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1;font-size:12px;color:#64748b;word-break:break-all;margin-bottom:16px;">
			<p style="margin:0 0 6px 0;font-weight:600;color:#475569;">Or copy and paste this link:</p>
			<a href="${data.resetUrl}" style="color:#2563eb;text-decoration:underline;">${data.resetUrl}</a>
		</div>

		<p style="margin:0;font-size:13px;color:#64748b;">
			If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
		</p>
	`;

	const text = [
		`Hello,`,
		``,
		`We received a request to reset your Century NIT account password.`,
		``,
		`Reset your password here:`,
		data.resetUrl,
		``,
		`If you did not ask for this, ignore this email — your password is unchanged.`,
	].join("\n");

	return {
		html: emailLayout({
			title: "Password Reset Request",
			preheader: "Reset your Century NIT password",
			bodyHtml,
			footerNote: "For security, this reset link can only be used once.",
		}),
		text,
	};
}

/* ── 3. Verification / Sign-In OTP Email Template ────────────────────────── */

export function renderOtpEmail(data: {
	otp: string;
	purpose: string;
	expiresMinutes: number;
}): { html: string; text: string } {
	const bodyHtml = `
		<p style="margin:0 0 16px 0;font-size:16px;color:#0f172a;">Hello,</p>
		<p style="margin:0 0 20px 0;color:#334155;">
			Use the verification code below to <strong>${escapeHtml(data.purpose)}</strong> on Century NIT:
		</p>

		<!-- OTP Code Box -->
		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
			<tr>
				<td align="center">
					<div style="display:inline-block;padding:16px 36px;background-color:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;letter-spacing:8px;font-size:32px;font-weight:800;color:#0f172a;font-family:Consolas,Monaco,'Courier New',monospace;">
						${escapeHtml(data.otp)}
					</div>
				</td>
			</tr>
		</table>

		<p style="margin:0;font-size:13px;color:#64748b;text-align:center;">
			This code will expire in <strong style="color:#d97706;">${data.expiresMinutes} minutes</strong>. Do not share this code with anyone.
		</p>
	`;

	const text = [
		`Your Century NIT verification code is: ${data.otp}`,
		``,
		`Use this code to ${data.purpose}. It expires in ${data.expiresMinutes} minutes.`,
		``,
		`Do not share this code with anyone.`,
	].join("\n");

	return {
		html: emailLayout({
			title: `Your Verification Code: ${data.otp}`,
			preheader: `Your one-time code is ${data.otp} (expires in ${data.expiresMinutes} minutes)`,
			bodyHtml,
			footerNote: "If you did not request this verification code, please ignore this email.",
		}),
		text,
	};
}

/* ── 4. Booking & Consultation Notification Template ─────────────────────── */

export function renderBookingEmail(data: {
	title: string;
	lines: string[];
	meetingUrl?: string | null;
	reference?: string;
}): { html: string; text: string } {
	const bodyHtml = `
		<div style="margin:0 0 20px 0;">
			${data.lines.map((l) => `<p style="margin:0 0 10px 0;color:#334155;font-size:15px;line-height:1.6;">${l}</p>`).join("")}
		</div>

		${data.meetingUrl ? `
		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:20px 0 24px 0;">
			<tr>
				<td align="center" style="border-radius:8px;background-color:#0f172a;">
					<a href="${data.meetingUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;background:#0f172a;">
						Join Consultation Meeting &rarr;
					</a>
				</td>
			</tr>
		</table>

		<div style="padding:12px 16px;background-color:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1;font-size:12px;color:#64748b;word-break:break-all;">
			<p style="margin:0 0 4px 0;font-weight:600;color:#475569;">Meeting Link:</p>
			<a href="${data.meetingUrl}" style="color:#2563eb;text-decoration:underline;">${data.meetingUrl}</a>
		</div>` : ""}
	`;

	const text = [
		data.title,
		"",
		...data.lines.map((l) => l.replace(/<[^>]+>/g, "")),
		...(data.meetingUrl ? ["", `Join Meeting: ${data.meetingUrl}`] : []),
		...(data.reference ? ["", `Reference: ${data.reference}`] : []),
	].join("\n");

	return {
		html: emailLayout({
			title: data.title,
			preheader: data.lines[0]?.replace(/<[^>]+>/g, "") || data.title,
			bodyHtml,
			footerNote: data.reference ? `Reference: ${data.reference}` : undefined,
		}),
		text,
	};
}
