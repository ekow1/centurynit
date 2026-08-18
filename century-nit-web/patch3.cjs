const fs = require('fs');
const file = 'src/react-app/pages/portal/PortalPages.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
	/<input id="a-inst".*?\/>/s,
	`<select id="a-inst" className="select select--full-border" value={assessment.institution} onChange={(e) => onUpdate({ institution: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('institution')}
	</select>`
);

content = content.replace(
	/<input id="a-fos".*?\/>/s,
	`<select id="a-fos" className="select select--full-border" value={assessment.fieldOfStudy} onChange={(e) => onUpdate({ fieldOfStudy: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('fieldOfStudy')}
	</select>`
);

content = content.replace(
	/<input id="a-pf".*?\/>/s,
	`<select id="a-pf" className="select select--full-border" value={assessment.preferredField} onChange={(e) => onUpdate({ preferredField: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('preferredField')}
	</select>`
);

content = content.replace(
	/<select id="a-fs".*?<\/select>/s,
	`<select id="a-fs" className="select select--full-border" value={assessment.fundingSource} onChange={(e) => onUpdate({ fundingSource: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('fundingSource')}
	</select>`
);

content = content.replace(
	/<select id="a-br".*?<\/select>/s,
	`<select id="a-br" className="select select--full-border" value={assessment.budgetRange} onChange={(e) => onUpdate({ budgetRange: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('budgetRange')}
	</select>`
);

content = content.replace(
	/<select id="a-ii".*?<\/select>/s,
	`<select id="a-ii" className="select select--full-border" value={assessment.intakePreference} onChange={(e) => onUpdate({ intakePreference: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('intakePreference')}
	</select>`
);

// If intakePreference is currently an input instead of select:
content = content.replace(
	/<input id="a-ii".*?\/>/s,
	`<select id="a-ii" className="select select--full-border" value={assessment.intakePreference} onChange={(e) => onUpdate({ intakePreference: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('intakePreference')}
	</select>`
);


fs.writeFileSync(file, content);
console.log("Patched remaining lookup fields");
