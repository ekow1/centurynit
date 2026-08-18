const fs = require('fs');
const file = 'src/react-app/pages/portal/PortalPages.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
	/<input id="a-pc2".*?\/>/s,
	`<select id="a-pc2" className="select select--full-border" value={assessment.preferredCountries} onChange={(e) => onUpdate({ preferredCountries: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('preferredCountries')}
	</select>`
);

fs.writeFileSync(file, content);
console.log("Patched preferredCountries");
