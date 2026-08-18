const fs = require('fs');
const file = 'src/react-app/pages/portal/PortalPages.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
	'const [section, setSection] = useState(0);',
	`const [section, setSection] = useState(0);
	const [lookups, setLookups] = useState<LookupValue[]>([]);
	
	useEffect(() => {
		apiFetch<{ lookups: LookupValue[] }>(\`\${API_PREFIX}/lookups\`)
			.then((res) => {
				if (res && res.lookups) setLookups(res.lookups);
			})
			.catch(console.error);
	}, []);

	const getLookupOptions = (category: string) => {
		return lookups.filter(l => l.category === category).map(l => (
			<option key={l.id} value={l.value}>{l.label}</option>
		));
	};`
);

content = content.replace(
	/<select id="a-gender".*?<\/select>/s,
	`<select id="a-gender" className="select select--full-border" value={assessment.gender} onChange={(e) => onUpdate({ gender: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('gender')}
	</select>`
);

content = content.replace(
	/<select id="a-edu".*?<\/select>/s,
	`<select id="a-edu" className="select select--full-border" value={assessment.highestEducation} onChange={(e) => onUpdate({ highestEducation: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('highestEducation')}
	</select>`
);

content = content.replace(
	/<select id="a-es".*?<\/select>/s,
	`<select id="a-es" className="select select--full-border" value={assessment.employmentStatus} onChange={(e) => onUpdate({ employmentStatus: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('employmentStatus')}
	</select>`
);

content = content.replace(
	/<select id="a-et".*?<\/select>/s,
	`<select id="a-et" className="select select--full-border" value={assessment.englishTest} onChange={(e) => onUpdate({ englishTest: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('englishTest')}
	</select>`
);

content = content.replace(
	/<select id="a-pl".*?<\/select>/s,
	`<select id="a-pl" className="select select--full-border" value={assessment.preferredLevel} onChange={(e) => onUpdate({ preferredLevel: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('preferredLevel')}
	</select>`
);

fs.writeFileSync(file, content);
console.log("Patched AssessmentForm");
