const fs = require('fs');

// 1. Update EnterpriseLookups.tsx
let lookupsCode = fs.readFileSync('src/pages/EnterpriseLookups.tsx', 'utf8');
lookupsCode = lookupsCode.replace(/<div className="page-content fade-in">/, '<div>');
lookupsCode = lookupsCode.replace(/<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem" }}>\s*<div>\s*<h1 className="page-title">Form Catalogue<\/h1>\s*<p className="lead mt-2">Manage dynamic dropdown options for the portal.<\/p>\s*<\/div>\s*<\/div>/s, '');
fs.writeFileSync('src/pages/EnterpriseLookups.tsx', lookupsCode);

// 2. Update EnterpriseUniversities.tsx
let uniCode = fs.readFileSync('src/pages/EnterpriseUniversities.tsx', 'utf8');
if (!uniCode.includes('EnterpriseLookups')) {
    uniCode = uniCode.replace('import { useOpsAuth } from "./OpsAuthContext";', 'import { useOpsAuth } from "./OpsAuthContext";\nimport { EnterpriseLookups } from "./EnterpriseLookups";');
    uniCode = uniCode.replace(/<button className="btn btn--ghost".*?Scholarships<\/button>/, $&
				<button 
					className={\tn btn--ghost \\} 
					style={{ paddingBottom: "0.5rem", borderBottom: tab === 'form-dropdowns' ? '2px solid var(--foreground)' : 'none', borderRadius: 0 }} 
					onClick={() => setTab('form-dropdowns')}
				>
					Form Dropdowns
				</button>);
    
    // Add tab state
    if (!uniCode.includes('const [tab, setTab] = useState')) {
        uniCode = uniCode.replace('export function EnterpriseUniversities() {', 'import { useState } from "react";\n\nexport function EnterpriseUniversities() {');
        uniCode = uniCode.replace('const { canEditUniversities } = useOpsAuth();', 'const { canEditUniversities } = useOpsAuth();\n\tconst [tab, setTab] = useState("universities");');
    }
    
    // Make existing tabs toggleable
    uniCode = uniCode.replace(/<button className="btn btn--ghost" style={{ borderBottom: "2px solid var\(--foreground\)", borderRadius: 0, paddingBottom: "0.5rem" }}>Universities<\/button>/, <button className={\tn btn--ghost \\} style={{ borderBottom: tab === 'universities' ? '2px solid var(--foreground)' : 'none', borderRadius: 0, paddingBottom: "0.5rem" }} onClick={() => setTab('universities')}>Universities</button>);
    uniCode = uniCode.replace(/<button className="btn btn--ghost" style={{ paddingBottom: "0.5rem", color: "var\(--muted-foreground\)" }}>Programs<\/button>/, <button className={\tn btn--ghost \\} style={{ borderBottom: tab === 'programs' ? '2px solid var(--foreground)' : 'none', borderRadius: 0, paddingBottom: "0.5rem" }} onClick={() => setTab('programs')}>Programs</button>);
    uniCode = uniCode.replace(/<button className="btn btn--ghost" style={{ paddingBottom: "0.5rem", color: "var\(--muted-foreground\)" }}>Countries<\/button>/, <button className={\tn btn--ghost \\} style={{ borderBottom: tab === 'countries' ? '2px solid var(--foreground)' : 'none', borderRadius: 0, paddingBottom: "0.5rem" }} onClick={() => setTab('countries')}>Countries</button>);
    uniCode = uniCode.replace(/<button className="btn btn--ghost" style={{ paddingBottom: "0.5rem", color: "var\(--muted-foreground\)" }}>Scholarships<\/button>/, <button className={\tn btn--ghost \\} style={{ borderBottom: tab === 'scholarships' ? '2px solid var(--foreground)' : 'none', borderRadius: 0, paddingBottom: "0.5rem" }} onClick={() => setTab('scholarships')}>Scholarships</button>);
    
    // Wrap existing content in {tab === '...' && (...)}
    uniCode = uniCode.replace(/<div className="card">\s*<div style={{ display: "flex"/, '{tab === "universities" && (\n\t\t\t<div className="card">\n\t\t\t\t<div style={{ display: "flex"');
    
    // The universities card ends right before {/* Programs Tab */} (if it exists) or before {/* Stats Footer */}
    uniCode = uniCode.replace(/<\/div>\s*<\/div>\s*{\/\* Programs Tab \*\/}/s, '</div>\n\t\t\t</div>\n\t\t\t)}\n\n\t\t\t{/* Programs Tab */}');
    
    // Insert the Lookups tab right before Stats Footer
    uniCode = uniCode.replace(/{\/\* Stats Footer \*\/}/, {tab === "form-dropdowns" && (\n\t\t\t\t<EnterpriseLookups />\n\t\t\t)}\n\n\t\t\t{/* Stats Footer */});
    
    fs.writeFileSync('src/pages/EnterpriseUniversities.tsx', uniCode);
}
