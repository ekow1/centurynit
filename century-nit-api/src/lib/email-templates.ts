/**
 * Century NIT — Monochrome Email Design System
 *
 * Responsive HTML email templates matching the web design system:
 * Pure black/white, sharp edges (no border-radius), serif type,
 * thick borders, no gradients or shadows.
 */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Base email wrapper layout — monochrome, sharp edges */
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
		body, table, td {font-family: Georgia, 'Times New Roman', Times, serif !important;}
	</style>
	<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Georgia,'Times New Roman',Times,serif;-webkit-font-smoothing:antialiased;color:#000000;">
	${preheader ? `<div style="display:none;font-size:1px;color:#f5f5f5;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>` : ""}

	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f5f5f5;padding:32px 16px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border:4px solid #000000;">

					<!-- Header -->
					<tr>
						<td style="background-color:#000000;padding:28px 36px;text-align:left;border-bottom:4px solid #000000;">
							<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
								<tr>
									<td>
										<div style="display:inline-block;padding:3px 8px;border:1px solid #ffffff;margin-bottom:8px;">
											<span style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">Century NIT</span>
										</div>
										<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;font-family:Georgia,'Times New Roman',Times,serif;">
											${escapeHtml(title)}
										</h1>
									</td>
								</tr>
							</table>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding:36px 36px 28px 36px;font-size:15px;line-height:1.65;color:#000000;">
							${bodyHtml}
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color:#f5f5f5;padding:24px 36px;border-top:2px solid #000000;text-align:center;font-size:12px;line-height:1.6;color:#666666;">
							${footerNote ? `<p style="margin:0 0 8px 0;color:#999999;">${footerNote}</p>` : ""}
							<p style="margin:0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.5px;">
								Century NIT Consult
							</p>
							<p style="margin:4px 0 0 0;color:#999999;">
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
	name?: string | null;
	inviterName: string;
	role: string;
	branch?: string | null;
	acceptUrl: string;
	expiresDays: number;
}): { html: string; text: string } {
	const safeName = data.name ? escapeHtml(data.name.trim()) : null;
	const greeting = safeName ? `Hello <strong>${safeName}</strong>,` : `Hello,`;
	const safeInviter = escapeHtml(data.inviterName.trim());
	const safeRole = escapeHtml(data.role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
	const safeBranch = data.branch ? escapeHtml(data.branch.toUpperCase()) : null;

	const bodyHtml = `
		<p style="margin:0 0 18px 0;font-size:16px;color:#000000;">
			${greeting}
		</p>

		<p style="margin:0 0 20px 0;color:#000000;">
			<strong>${safeInviter}</strong> has invited you to join the <strong>Century NIT Operations Center</strong> as a staff member.
		</p>

		<!-- Role & Assignment Card -->
		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;background-color:#f5f5f5;border:2px solid #000000;padding:16px 20px;">
			<tr>
				<td>
					<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
						<tr>
							<td style="padding:4px 0;font-size:13px;color:#666666;width:110px;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.3px;">Assigned Role</td>
							<td style="padding:4px 0;font-size:14px;font-weight:700;color:#000000;">${safeRole}</td>
						</tr>
						${safeBranch ? `
						<tr>
							<td style="padding:4px 0;font-size:13px;color:#666666;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.3px;">Branch</td>
							<td style="padding:4px 0;font-size:14px;font-weight:600;color:#000000;">${safeBranch} Branch</td>
						</tr>` : ""}
						<tr>
							<td style="padding:4px 0;font-size:13px;color:#666666;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.3px;">Link Validity</td>
							<td style="padding:4px 0;font-size:14px;font-weight:600;color:#000000;">${data.expiresDays} days (single use)</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>

		<p style="margin:0 0 24px 0;color:#000000;">
			Click the button below to accept your invitation, create your password, and access the platform.
		</p>

		<!-- Action Button -->
		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;">
			<tr>
				<td align="center" style="background-color:#000000;">
					<a href="${data.acceptUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;background-color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.5px;text-transform:uppercase;">
						Accept Invitation &amp; Set Password
					</a>
				</td>
			</tr>
		</table>

		<!-- Fallback link -->
		<div style="padding:14px 18px;background-color:#f5f5f5;border:1px dashed #999999;font-size:12px;color:#666666;word-break:break-all;">
			<p style="margin:0 0 6px 0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.3px;">Button not working? Paste this link into your browser:</p>
			<a href="${data.acceptUrl}" style="color:#000000;text-decoration:underline;">${data.acceptUrl}</a>
		</div>
	`;

	const text = [
		safeName ? `Hello ${data.name!.trim()},` : `Hello,`,
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
		<p style="margin:0 0 16px 0;font-size:16px;color:#000000;">${greeting}</p>
		<p style="margin:0 0 20px 0;color:#000000;">
			We received a request to reset your password for your Century NIT account. Click the button below to choose a new password:
		</p>

		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;">
			<tr>
				<td align="center" style="background-color:#000000;">
					<a href="${data.resetUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;background-color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.5px;text-transform:uppercase;">
						Reset Password
					</a>
				</td>
			</tr>
		</table>

		<div style="padding:14px 18px;background-color:#f5f5f5;border:1px dashed #999999;font-size:12px;color:#666666;word-break:break-all;margin-bottom:16px;">
			<p style="margin:0 0 6px 0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.3px;">Or copy and paste this link:</p>
			<a href="${data.resetUrl}" style="color:#000000;text-decoration:underline;">${data.resetUrl}</a>
		</div>

		<p style="margin:0;font-size:13px;color:#666666;">
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

/* ── 2b. Email Verification Template ─────────────────────────────────────── */

export function renderVerificationEmail(data: {
	name?: string;
	verificationUrl: string;
}): { html: string; text: string } {
	const greeting = data.name ? `Hello <strong>${escapeHtml(data.name)}</strong>,` : `Hello,`;

	const bodyHtml = `
		<p style="margin:0 0 16px 0;font-size:16px;color:#000000;">${greeting}</p>
		<p style="margin:0 0 20px 0;color:#000000;">
			Welcome to Century NIT. Confirm your email address to activate your account and start your application journey:
		</p>

		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;">
			<tr>
				<td align="center" style="background-color:#000000;">
					<a href="${data.verificationUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;background-color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.5px;text-transform:uppercase;">
						Verify Email
					</a>
				</td>
			</tr>
		</table>

		<div style="padding:14px 18px;background-color:#f5f5f5;border:1px dashed #999999;font-size:12px;color:#666666;word-break:break-all;margin-bottom:16px;">
			<p style="margin:0 0 6px 0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.3px;">Or copy and paste this link:</p>
			<a href="${data.verificationUrl}" style="color:#000000;text-decoration:underline;">${data.verificationUrl}</a>
		</div>

		<p style="margin:0;font-size:13px;color:#666666;">
			If you did not create a Century NIT account, you can safely ignore this email.
		</p>
	`;

	const text = [
		`Hello,`,
		``,
		`Welcome to Century NIT. Confirm your email address to activate your account:`,
		``,
		data.verificationUrl,
		``,
		`If you did not create an account, you can safely ignore this email.`,
	].join("\n");

	return {
		html: emailLayout({
			title: "Verify Your Email Address",
			preheader: "Confirm your Century NIT account email",
			bodyHtml,
			footerNote: "This verification link expires after 24 hours.",
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
		<p style="margin:0 0 16px 0;font-size:16px;color:#000000;">Hello,</p>
		<p style="margin:0 0 20px 0;color:#000000;">
			Use the verification code below to <strong>${escapeHtml(data.purpose)}</strong> on Century NIT:
		</p>

		<!-- OTP Code Box -->
		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
			<tr>
				<td align="center">
					<div style="display:inline-block;padding:16px 36px;background-color:#f5f5f5;border:4px solid #000000;letter-spacing:8px;font-size:32px;font-weight:800;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">
						${escapeHtml(data.otp)}
					</div>
				</td>
			</tr>
		</table>

		<p style="margin:0;font-size:13px;color:#666666;text-align:center;">
			This code will expire in <strong>${data.expiresMinutes} minutes</strong>. Do not share this code with anyone.
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
			${data.lines.map((l) => `<p style="margin:0 0 10px 0;color:#000000;font-size:15px;line-height:1.6;">${l}</p>`).join("")}
		</div>

		${data.meetingUrl ? `
		<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:20px 0 24px 0;">
			<tr>
				<td align="center" style="background-color:#000000;">
					<a href="${data.meetingUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;background-color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:0.5px;text-transform:uppercase;">
						Join Consultation Meeting
					</a>
				</td>
			</tr>
		</table>

		<div style="padding:12px 16px;background-color:#f5f5f5;border:1px dashed #999999;font-size:12px;color:#666666;word-break:break-all;">
			<p style="margin:0 0 4px 0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.3px;">Meeting Link</p>
			<a href="${data.meetingUrl}" style="color:#000000;text-decoration:underline;">${data.meetingUrl}</a>
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
