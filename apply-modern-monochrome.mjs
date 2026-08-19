import fs from 'fs';

function applyModernMonochrome(filePath, isClient) {
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Fix Window Container
    content = content.replace(/const windowContainerStyle: CSSProperties = {[\s\S]*?};/m, `const windowContainerStyle: CSSProperties = {
\tposition: "fixed",
\tbottom: "24px",
\tright: "24px",
\tzIndex: 9999,
\twidth: "360px",
\theight: "600px",
\tmaxHeight: "calc(100vh - 48px)",
\tbackground: "#ffffff",
\tborder: "1px solid #e4e4e7",
\tborderRadius: "16px",
\tboxShadow: "0 10px 40px -10px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)",
\tdisplay: "flex",
\tflexDirection: "column",
\toverflow: "hidden",
\tcolor: "#18181b",
\ttransition: "width 0.2s ease, height 0.2s ease, transform 0.2s ease",
};`);

    content = content.replace(/const windowExpandedStyle: CSSProperties = {[\s\S]*?};/m, `const windowExpandedStyle: CSSProperties = {
\twidth: "800px",
\tmaxHeight: "calc(100vh - 48px)",
\tmaxWidth: "calc(100vw - 48px)",
};`);

    // 2. Fix Header
    content = content.replace(/const headerStyle: CSSProperties = {[\s\S]*?};/m, `const headerStyle: CSSProperties = {
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "12px 16px",
\tbackground: "#ffffff",
\tborderBottom: "1px solid #f4f4f5",
};`);

    content = content.replace(/const headerTitleStyle: CSSProperties = {[\s\S]*?};/m, `const headerTitleStyle: CSSProperties = {
\tfontSize: "13px",
\tfontWeight: 700,
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tcolor: "#18181b",
};`);

    content = content.replace(/const controlBtnStyle: CSSProperties = {[\s\S]*?};/m, `const controlBtnStyle: CSSProperties = {
\tbackground: "transparent",
\tborder: "none",
\tcolor: "#71717a",
\twidth: "28px",
\theight: "28px",
\tborderRadius: "50%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tcursor: "pointer",
\tfontSize: "14px",
\ttransition: "background 0.2s ease, color 0.2s ease",
};`);

    // 3. Fix Channel Nav
    content = content.replace(/const channelNavStyle: CSSProperties = {[\s\S]*?};/m, `const channelNavStyle: CSSProperties = {
\tdisplay: "grid",
\t${isClient ? 'gridTemplateColumns: "1fr 1fr 1fr"' : 'gridTemplateColumns: "1fr 1fr"'},
\tborderBottom: "1px solid #f4f4f5",
\tbackground: "#fafafa",
};`);

    content = content.replace(/const channelBtnStyle: CSSProperties = {[\s\S]*?};/m, `const channelBtnStyle: CSSProperties = {
\tpadding: "12px 8px",
\tbackground: "transparent",
\tborder: "none",
\tborderBottom: "2px solid transparent",
\tcolor: "#71717a",
\tfontSize: "12px",
\tfontWeight: 600,
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tgap: "6px",
\tcursor: "pointer",
\ttransition: "color 0.2s ease",
};`);

    content = content.replace(/const activeChannelBtnStyle: CSSProperties = {[\s\S]*?};/m, `const activeChannelBtnStyle: CSSProperties = {
\tcolor: "#18181b",
\tborderBottomColor: "#18181b",
};`);

    // 4. Input & Search
    content = content.replace(/const searchInputStyle: CSSProperties = {[\s\S]*?};/m, `const searchInputStyle: CSSProperties = {
\twidth: "calc(100% - 24px)",
\tmargin: "12px",
\tbackground: "#f4f4f5",
\tborder: "1px solid transparent",
\tborderRadius: "8px",
\tcolor: "#18181b",
\tpadding: "10px 14px",
\tfontSize: "13px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\toutline: "none",
\tboxSizing: "border-box",
\ttransition: "border 0.2s ease",
};`);

    content = content.replace(/const formStyle: CSSProperties = {[\s\S]*?};/m, `const formStyle: CSSProperties = {
\tdisplay: "flex",
\tpadding: "12px 16px",
\tbackground: "#ffffff",
\tborderTop: "1px solid #f4f4f5",
\tgap: "10px",
\talignItems: "center",
};`);

    content = content.replace(/const inputStyle: CSSProperties = {[\s\S]*?};/m, `const inputStyle: CSSProperties = {
\tflex: 1,
\tbackground: "#f4f4f5",
\tborder: "1px solid transparent",
\tborderRadius: "20px",
\tcolor: "#18181b",
\tpadding: "10px 16px",
\tfontSize: "13px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\toutline: "none",
\ttransition: "background 0.2s ease",
};`);

    content = content.replace(/const sendBtnStyle: CSSProperties = {[\s\S]*?};/m, `const sendBtnStyle: CSSProperties = {
\tbackground: "#18181b",
\tcolor: "#ffffff",
\tborder: "none",
\tborderRadius: "50%",
\twidth: "36px",
\theight: "36px",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tcursor: "pointer",
\ttransition: "transform 0.1s ease, background 0.2s ease",
};`);

    // 5. Avatars & Bubbles
    content = content.replace(/const avatarPillStyle: CSSProperties = {[\s\S]*?};/m, `const avatarPillStyle: CSSProperties = {
\twidth: "36px",
\theight: "36px",
\tborderRadius: "50%",
\tbackground: "#f4f4f5",
\tcolor: "#18181b",
\tfontWeight: 600,
\tfontSize: "12px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tborder: "1px solid #e4e4e7",
};`);

    content = content.replace(/const avatarMiniStyle: CSSProperties = {[\s\S]*?};/m, `const avatarMiniStyle: CSSProperties = {
\twidth: "28px",
\theight: "28px",
\tborderRadius: "50%",
\tbackground: "#f4f4f5",
\tcolor: "#18181b",
\tfontWeight: 600,
\tfontSize: "10px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tborder: "1px solid #e4e4e7",
};`);

    content = content.replace(/const myBubbleStyle: CSSProperties = {[\s\S]*?};/m, `const myBubbleStyle: CSSProperties = {
\tbackground: "#18181b",
\tcolor: "#ffffff",
\tborder: "none",
\tborderRadius: "16px 16px 4px 16px",
};`);

    content = content.replace(/const theirBubbleStyle: CSSProperties = {[\s\S]*?};/m, `const theirBubbleStyle: CSSProperties = {
\tbackground: "#f4f4f5",
\tcolor: "#18181b",
\tborder: "none",
\tborderRadius: "16px 16px 16px 4px",
};`);

    content = content.replace(/const messageBubbleStyle: CSSProperties = {[\s\S]*?};/m, `const messageBubbleStyle: CSSProperties = {
\tmaxWidth: "75%",
\tpadding: "10px 14px",
\tfontSize: "13px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tlineHeight: "1.4",
};`);

    // 6. Section Headers & Borders
    content = content.replace(/const sectionHeaderStyle: CSSProperties = {[\s\S]*?};/m, `const sectionHeaderStyle: CSSProperties = {
\tpadding: "8px 16px",
\tbackground: "#ffffff",
\tcolor: "#a1a1aa",
\tfontSize: "11px",
\tfontWeight: 600,
\ttextTransform: "uppercase",
\tletterSpacing: "0.05em",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tborderBottom: "1px solid #f4f4f5",
};`);

    content = content.replace(/const activeChatRowStyle: CSSProperties = {[\s\S]*?};/m, `const activeChatRowStyle: CSSProperties = {
\twidth: "100%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "12px 16px",
\tbackground: "#fafafa",
\tborder: "none",
\tborderBottom: "1px solid #f4f4f5",
\tcursor: "pointer",
\ttextAlign: "left",
\ttransition: "background 0.2s ease",
};`);

    content = content.replace(/const staffCardBtnStyle: CSSProperties = {[\s\S]*?};/m, `const staffCardBtnStyle: CSSProperties = {
\twidth: "100%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "12px 16px",
\tbackground: "transparent",
\tborder: "none",
\tborderBottom: "1px solid #f4f4f5",
\tcursor: "pointer",
\ttextAlign: "left",
\ttransition: "background 0.2s ease",
};`);

    content = content.replace(/const clientChatCardBtnStyle: CSSProperties = {[\s\S]*?};/m, `const clientChatCardBtnStyle: CSSProperties = {
\twidth: "100%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "12px 16px",
\tbackground: "transparent",
\tborder: "none",
\tborderBottom: "1px solid #f4f4f5",
\tcursor: "pointer",
\ttextAlign: "left",
\ttransition: "background 0.2s ease",
};`);

    content = content.replace(/const threadHeaderStyle: CSSProperties = {[\s\S]*?};/m, `const threadHeaderStyle: CSSProperties = {
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "12px 16px",
\tbackground: "#ffffff",
\tborderBottom: "1px solid #f4f4f5",
};`);

    content = content.replace(/const officerHeaderCardStyle: CSSProperties = {[\s\S]*?};/m, `const officerHeaderCardStyle: CSSProperties = {
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "12px 16px",
\tbackground: "#ffffff",
\tborderBottom: "1px solid #f4f4f5",
};`);

    content = content.replace(/const backBtnStyle: CSSProperties = {[\s\S]*?};/m, `const backBtnStyle: CSSProperties = {
\tbackground: "transparent",
\tborder: "none",
\tcolor: "#71717a",
\tpadding: "6px",
\tborderRadius: "50%",
\tfontSize: "14px",
\tcursor: "pointer",
\ttransition: "background 0.2s ease, color 0.2s ease",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
};`);

    content = content.replace(/const presenceBadgeStyle: CSSProperties = {[\s\S]*?};/m, `const presenceBadgeStyle: CSSProperties = {
\tfontSize: "10px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tfontWeight: 600,
\tcolor: "#52525b",
\tbackground: "#f4f4f5",
\tborder: "none",
\tpadding: "2px 8px",
\tborderRadius: "12px",
};`);

    content = content.replace(/const stagePillStyle: CSSProperties = {[\s\S]*?};/m, `const stagePillStyle: CSSProperties = {
\tfontSize: "10px",
\tfontFamily: "system-ui, -apple-system, sans-serif",
\tfontWeight: 600,
\tcolor: "#52525b",
\tbackground: "#f4f4f5",
\tborder: "none",
\tpadding: "2px 8px",
\tborderRadius: "12px",
};`);

    // Launcher
    content = content.replace(/const launcherSquareBtnStyle: CSSProperties = {[\s\S]*?};/m, `const launcherSquareBtnStyle: CSSProperties = {
\tposition: "fixed",
\tbottom: "24px",
\tright: "24px",
\tzIndex: 9999,
\twidth: "56px",
\theight: "56px",
\tbackground: "#18181b",
\tcolor: "#ffffff",
\tborder: "none",
\tborderRadius: "50%",
\tboxShadow: "0 10px 25px -5px rgba(0,0,0,0.2)",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tcursor: "pointer",
\ttransition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
};`);

    fs.writeFileSync(filePath, content, 'utf8');
}

applyModernMonochrome('d:/projects/century-nit-suite/century-nit-ops/src/pages/CommunicationHub.tsx', false);
applyModernMonochrome('d:/projects/century-nit-suite/century-nit-web/src/react-app/pages/portal/CommunicationCenter.tsx', true);

console.log("Modern Monochrome applied!");
