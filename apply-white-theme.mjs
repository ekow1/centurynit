import fs from 'fs';

function replaceCommon(content) {
    // Make the launcher stay black (we preserve it by temporarily replacing it)
    content = content.replace(/background: "#000000",\n\tcolor: "#ffffff",\n\tborder: "1px solid #27272a"/g, 'background: "__LAUNCHER_BG__",\n\tcolor: "__LAUNCHER_TEXT__",\n\tborder: "__LAUNCHER_BORDER__"');

    // Make my bubble white with black border, and their bubble light grey
    // Wait, #ffffff is white, #18181b is dark grey.
    content = content.replace(/const myBubbleStyle: CSSProperties = {\n\tbackground: "#ffffff",\n\tcolor: "#09090b",\n\tborder: "1px solid #ffffff",\n};/g, 'const myBubbleStyle: CSSProperties = {\n\tbackground: "#ffffff",\n\tcolor: "#000000",\n\tborder: "1px solid #e4e4e7",\n};');
    content = content.replace(/const theirBubbleStyle: CSSProperties = {\n\tbackground: "#18181b",\n\tcolor: "#f4f4f5",\n\tborder: "1px solid #27272a",\n};/g, 'const theirBubbleStyle: CSSProperties = {\n\tbackground: "#f4f4f5",\n\tcolor: "#000000",\n\tborder: "1px solid #e4e4e7",\n};');

    // Replace inline and style block backgrounds
    content = content.replace(/#09090b/g, '#ffffff'); // window bg
    content = content.replace(/#18181b/g, '#f4f4f5'); // secondary bg
    content = content.replace(/#121215/g, '#f4f4f5'); // header bg
    
    // Replace text colors
    content = content.replace(/#fafafa/g, '#000000');
    content = content.replace(/#f4f4f5/g, '#000000');
    content = content.replace(/#a1a1aa/g, '#52525b');
    content = content.replace(/#71717a/g, '#52525b');

    // Replace deep backgrounds and borders
    content = content.replace(/background: "#000000"/g, 'background: "#ffffff"');
    content = content.replace(/#27272a/g, '#e4e4e7'); // borders

    // Indicator Dot default background
    content = content.replace(/background: "#ffffff",\n\tborderRadius: "0px",\n};\n\nconst headerTitleStyle/g, 'background: "#10b981",\n\tborderRadius: "0px",\n};\n\nconst headerTitleStyle');
    
    // Restore launcher
    content = content.replace(/__LAUNCHER_BG__/g, '#000000');
    content = content.replace(/__LAUNCHER_TEXT__/g, '#ffffff');
    content = content.replace(/__LAUNCHER_BORDER__/g, '1px solid #000000');

    // Also change unread badge background to red so it stands out on white
    content = content.replace(/const unreadSquareBadgeStyle: CSSProperties = {\n\tposition: "absolute",\n\ttop: "-6px",\n\tright: "-6px",\n\tbackground: "#ffffff",\n\tcolor: "#000000",/g, 'const unreadSquareBadgeStyle: CSSProperties = {\n\tposition: "absolute",\n\ttop: "-6px",\n\tright: "-6px",\n\tbackground: "#dc2626",\n\tcolor: "#ffffff",');
    content = content.replace(/const unreadSquareBadgeInlineStyle: CSSProperties = {\n\tbackground: "#ffffff",\n\tcolor: "#000000",/g, 'const unreadSquareBadgeInlineStyle: CSSProperties = {\n\tbackground: "#dc2626",\n\tcolor: "#ffffff",');

    // Invert the dark pills
    content = content.replace(/const stagePillStyle: CSSProperties = {\n\tfontSize: "9px",\n\tfontFamily: "monospace",\n\tfontWeight: 700,\n\tcolor: "#a1a1aa",\n\tbackground: "#000000",/g, 'const stagePillStyle: CSSProperties = {\n\tfontSize: "9px",\n\tfontFamily: "monospace",\n\tfontWeight: 700,\n\tcolor: "#52525b",\n\tbackground: "#e4e4e7",');
    content = content.replace(/const stagePillMiniStyle: CSSProperties = {\n\tfontSize: "9px",\n\tfontFamily: "monospace",\n\tfontWeight: 700,\n\tcolor: "#a1a1aa",\n\tbackground: "#000000",/g, 'const stagePillMiniStyle: CSSProperties = {\n\tfontSize: "9px",\n\tfontFamily: "monospace",\n\tfontWeight: 700,\n\tcolor: "#52525b",\n\tbackground: "#e4e4e7",');

    return content;
}

function processOps() {
    let content = fs.readFileSync('d:/projects/century-nit-suite/century-nit-ops/src/pages/CommunicationHub.tsx', 'utf8');
    content = replaceCommon(content);
    
    // Dynamic presence colors
    content = content.replace(/<span style={presenceBadgeStyle}>{staff\.presence\.toUpperCase\(\)}<\/span>/g, '<span style={{ ...presenceBadgeStyle, color: "#ffffff", border: "none", background: staff.presence === "available" ? "#10b981" : staff.presence === "busy" ? "#ef4444" : staff.presence === "on_leave" ? "#f59e0b" : "#71717a" }}>{staff.presence.toUpperCase()}</span>');
    content = content.replace(/<span style={indicatorDotStyle} \/>/g, '<span style={{ ...indicatorDotStyle, background: presenceStatus === "available" ? "#10b981" : presenceStatus === "busy" ? "#ef4444" : presenceStatus === "on_leave" ? "#f59e0b" : "#71717a" }} />');

    fs.writeFileSync('d:/projects/century-nit-suite/century-nit-ops/src/pages/CommunicationHub.tsx', content, 'utf8');
}

function processWeb() {
    let content = fs.readFileSync('d:/projects/century-nit-suite/century-nit-web/src/react-app/pages/portal/CommunicationCenter.tsx', 'utf8');
    content = replaceCommon(content);

    // Static online green dot
    content = content.replace(/<span style={indicatorDotStyle} \/>/g, '<span style={{ ...indicatorDotStyle, background: "#10b981" }} />');

    fs.writeFileSync('d:/projects/century-nit-suite/century-nit-web/src/react-app/pages/portal/CommunicationCenter.tsx', content, 'utf8');
}

processOps();
processWeb();
console.log("Done");
