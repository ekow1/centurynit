import fs from 'fs';

function fixBrutalism(filePath, isClient) {
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
\tborder: "2px solid #000000",
\tborderRadius: "0px",
\tboxShadow: "6px 6px 0px rgba(0,0,0,1)",
\tdisplay: "flex",
\tflexDirection: "column",
\toverflow: "hidden",
\tcolor: "#000000",
\ttransition: "width 0.2s ease, height 0.2s ease",
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
\tpadding: "10px 14px",
\tbackground: "#ffffff",
\tborderBottom: "2px solid #000000",
};`);

    content = content.replace(/const headerTitleStyle: CSSProperties = {[\s\S]*?};/m, `const headerTitleStyle: CSSProperties = {
\tfontSize: "12px",
\tfontWeight: 800,
\tletterSpacing: "0.08em",
\tfontFamily: "monospace",
\tcolor: "#000000",
\ttextTransform: "uppercase",
};`);

    content = content.replace(/const controlBtnStyle: CSSProperties = {[\s\S]*?};/m, `const controlBtnStyle: CSSProperties = {
\tbackground: "#ffffff",
\tborder: "2px solid #000000",
\tcolor: "#000000",
\twidth: "24px",
\theight: "24px",
\tborderRadius: "0px",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tcursor: "pointer",
\tfontSize: "12px",
\tfontWeight: 800,
};`);

    // 3. Fix Channel Nav
    content = content.replace(/const channelNavStyle: CSSProperties = {[\s\S]*?};/m, `const channelNavStyle: CSSProperties = {
\tdisplay: "grid",
\t${isClient ? 'gridTemplateColumns: "1fr 1fr 1fr"' : 'gridTemplateColumns: "1fr 1fr"'},
\tborderBottom: "2px solid #000000",
\tbackground: "#ffffff",
};`);

    content = content.replace(/const channelBtnStyle: CSSProperties = {[\s\S]*?};/m, `const channelBtnStyle: CSSProperties = {
\tpadding: "10px 8px",
\tbackground: "#ffffff",
\tborder: "none",
\tborderRight: "2px solid #000000",
\tborderBottom: "2px solid #000000",
\tcolor: "#000000",
\tfontSize: "11px",
\tfontWeight: 800,
\tletterSpacing: "0.06em",
\tfontFamily: "monospace",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tgap: "6px",
\tcursor: "pointer",
\tborderRadius: "0px",
\ttextTransform: "uppercase",
};`);

    content = content.replace(/const activeChannelBtnStyle: CSSProperties = {[\s\S]*?};/m, `const activeChannelBtnStyle: CSSProperties = {
\tcolor: "#ffffff",
\tbackground: "#000000",
};`);

    // 4. Input & Search
    content = content.replace(/const searchInputStyle: CSSProperties = {[\s\S]*?};/m, `const searchInputStyle: CSSProperties = {
\twidth: "100%",
\tbackground: "#ffffff",
\tborder: "2px solid #000000",
\tborderRadius: "0px",
\tcolor: "#000000",
\tpadding: "8px 12px",
\tfontSize: "12px",
\tfontFamily: "monospace",
\toutline: "none",
\tboxSizing: "border-box",
\tfontWeight: 700,
};`);

    content = content.replace(/const formStyle: CSSProperties = {[\s\S]*?};/m, `const formStyle: CSSProperties = {
\tdisplay: "flex",
\tpadding: "10px",
\tbackground: "#ffffff",
\tborderTop: "2px solid #000000",
\tgap: "8px",
};`);

    content = content.replace(/const inputStyle: CSSProperties = {[\s\S]*?};/m, `const inputStyle: CSSProperties = {
\tflex: 1,
\tbackground: "#ffffff",
\tborder: "2px solid #000000",
\tborderRadius: "0px",
\tcolor: "#000000",
\tpadding: "8px 12px",
\tfontSize: "13px",
\tfontWeight: 600,
\toutline: "none",
};`);

    content = content.replace(/const sendBtnStyle: CSSProperties = {[\s\S]*?};/m, `const sendBtnStyle: CSSProperties = {
\tbackground: "#000000",
\tcolor: "#ffffff",
\tborder: "none",
\tborderRadius: "0px",
\tpadding: "8px 16px",
\tfontWeight: 800,
\tfontSize: "12px",
\tfontFamily: "monospace",
\tletterSpacing: "0.05em",
\tcursor: "pointer",
};`);

    // 5. Avatars & Bubbles
    content = content.replace(/const avatarPillStyle: CSSProperties = {[\s\S]*?};/m, `const avatarPillStyle: CSSProperties = {
\twidth: "32px",
\theight: "32px",
\tborderRadius: "0px",
\tbackground: "#000000",
\tcolor: "#ffffff",
\tfontWeight: 800,
\tfontSize: "12px",
\tfontFamily: "monospace",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tborder: "2px solid #000000",
};`);

    content = content.replace(/const avatarMiniStyle: CSSProperties = {[\s\S]*?};/m, `const avatarMiniStyle: CSSProperties = {
\twidth: "24px",
\theight: "24px",
\tborderRadius: "0px",
\tbackground: "#000000",
\tcolor: "#ffffff",
\tfontWeight: 700,
\tfontSize: "10px",
\tfontFamily: "monospace",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
};`);

    content = content.replace(/const myBubbleStyle: CSSProperties = {[\s\S]*?};/m, `const myBubbleStyle: CSSProperties = {
\tbackground: "#ffffff",
\tcolor: "#000000",
\tborder: "2px solid #000000",
\tboxShadow: "2px 2px 0px #000000",
};`);

    content = content.replace(/const theirBubbleStyle: CSSProperties = {[\s\S]*?};/m, `const theirBubbleStyle: CSSProperties = {
\tbackground: "#f4f4f5",
\tcolor: "#000000",
\tborder: "2px solid #000000",
};`);

    content = content.replace(/const messageBubbleStyle: CSSProperties = {[\s\S]*?};/m, `const messageBubbleStyle: CSSProperties = {
\tmaxWidth: "80%",
\tpadding: "10px 14px",
\tborderRadius: "0px",
\tfontSize: "13px",
\tfontWeight: 500,
};`);

    // 6. Section Headers & Borders
    content = content.replace(/const sectionHeaderStyle: CSSProperties = {[\s\S]*?};/m, `const sectionHeaderStyle: CSSProperties = {
\tpadding: "8px 12px",
\tbackground: "#e4e4e7",
\tcolor: "#000000",
\tfontSize: "10px",
\tfontWeight: 800,
\tletterSpacing: "0.1em",
\tfontFamily: "monospace",
\tborderBottom: "2px solid #000000",
\tborderTop: "2px solid #000000",
};`);

    content = content.replace(/const activeChatRowStyle: CSSProperties = {[\s\S]*?};/m, `const activeChatRowStyle: CSSProperties = {
\twidth: "100%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "10px 12px",
\tbackground: "transparent",
\tborder: "none",
\tborderBottom: "1px solid #d4d4d8",
\tborderRadius: "0px",
\tcursor: "pointer",
\ttextAlign: "left",
};`);

    content = content.replace(/const staffCardBtnStyle: CSSProperties = {[\s\S]*?};/m, `const staffCardBtnStyle: CSSProperties = {
\twidth: "100%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "10px 12px",
\tbackground: "transparent",
\tborder: "none",
\tborderBottom: "1px solid #d4d4d8",
\tborderRadius: "0px",
\tcursor: "pointer",
};`);

    content = content.replace(/const clientChatCardBtnStyle: CSSProperties = {[\s\S]*?};/m, `const clientChatCardBtnStyle: CSSProperties = {
\twidth: "100%",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "10px 12px",
\tbackground: "transparent",
\tborder: "none",
\tborderBottom: "1px solid #d4d4d8",
\tborderRadius: "0px",
\tcursor: "pointer",
};`);

    content = content.replace(/const threadHeaderStyle: CSSProperties = {[\s\S]*?};/m, `const threadHeaderStyle: CSSProperties = {
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "10px 14px",
\tbackground: "#ffffff",
\tborderBottom: "2px solid #000000",
};`);

    content = content.replace(/const officerHeaderCardStyle: CSSProperties = {[\s\S]*?};/m, `const officerHeaderCardStyle: CSSProperties = {
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "space-between",
\tpadding: "10px 14px",
\tbackground: "#ffffff",
\tborderBottom: "2px solid #000000",
};`);

    content = content.replace(/const backBtnStyle: CSSProperties = {[\s\S]*?};/m, `const backBtnStyle: CSSProperties = {
\tbackground: "#ffffff",
\tborder: "2px solid #000000",
\tcolor: "#000000",
\tpadding: "4px 8px",
\tborderRadius: "0px",
\tfontSize: "11px",
\tfontWeight: 800,
\tcursor: "pointer",
};`);

    content = content.replace(/const presenceBadgeStyle: CSSProperties = {[\s\S]*?};/m, `const presenceBadgeStyle: CSSProperties = {
\tfontSize: "10px",
\tfontFamily: "monospace",
\tfontWeight: 800,
\tcolor: "#ffffff",
\tbackground: "#000000",
\tborder: "2px solid #000000",
\tpadding: "2px 6px",
\tborderRadius: "0px",
};`);

    content = content.replace(/const stagePillStyle: CSSProperties = {[\s\S]*?};/m, `const stagePillStyle: CSSProperties = {
\tfontSize: "10px",
\tfontFamily: "monospace",
\tfontWeight: 800,
\tcolor: "#000000",
\tbackground: "#ffffff",
\tborder: "2px solid #000000",
\tpadding: "2px 6px",
\tborderRadius: "0px",
};`);

    // Invert select colors
    content = content.replace(/const presenceSelectStyle: CSSProperties = {[\s\S]*?};/m, `const presenceSelectStyle: CSSProperties = {
\tbackground: "#ffffff",
\tcolor: "#000000",
\tborder: "2px solid #000000",
\tborderRadius: "0px",
\tfontSize: "11px",
\tfontWeight: 800,
\tfontFamily: "monospace",
\tpadding: "4px 8px",
\toutline: "none",
};`);

    // Launcher Box Shadow
    content = content.replace(/const launcherSquareBtnStyle: CSSProperties = {[\s\S]*?};/m, `const launcherSquareBtnStyle: CSSProperties = {
\tposition: "fixed",
\tbottom: "24px",
\tright: "24px",
\tzIndex: 9999,
\twidth: "48px",
\theight: "48px",
\tbackground: "#000000",
\tcolor: "#ffffff",
\tborder: "2px solid #000000",
\tborderRadius: "0px",
\tboxShadow: "4px 4px 0px rgba(0,0,0,0.5)",
\tdisplay: "flex",
\talignItems: "center",
\tjustifyContent: "center",
\tcursor: "pointer",
\ttransition: "transform 0.1s ease",
};`);

    fs.writeFileSync(filePath, content, 'utf8');
}

fixBrutalism('d:/projects/century-nit-suite/century-nit-ops/src/pages/CommunicationHub.tsx', false);
fixBrutalism('d:/projects/century-nit-suite/century-nit-web/src/react-app/pages/portal/CommunicationCenter.tsx', true);

console.log("Brutalism applied!");
