import fs from 'fs';
const file = 'src/react-app/pages/portal/PortalPages.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace the lookups state to include catalog state
content = content.replace(
	const [lookups, setLookups] = useState<LookupValue[]>([]);\n\t\n\tuseEffect(() => {\n\t\tapiFetch<{ lookups: LookupValue[] }>(\\/lookups\)\n\t\t\t.then((res) => {\n\t\t\t\tif (res && res.lookups) setLookups(res.lookups);\n\t\t\t})\n\t\t\t.catch(console.error);\n\t}, []);,
	const [lookups, setLookups] = useState<LookupValue[]>([]);
	const [catalogUnis, setCatalogUnis] = useState<any[]>([]);
	const [catalogDestinations, setCatalogDestinations] = useState<any[]>([]);
	const [catalogPrograms, setCatalogPrograms] = useState<any[]>([]);

	useEffect(() => {
		apiFetch<{ lookups: LookupValue[] }>(\\/lookups\)
			.then((res) => {
				if (res && res.lookups) setLookups(res.lookups);
			})
			.catch(console.error);

		apiFetch<{ universities: any[] }>(\\/catalog/universities\)
			.then(res => setCatalogUnis(res.universities))
			.catch(console.error);

		apiFetch<{ destinations: any[] }>(\\/catalog/destinations\)
			.then(res => setCatalogDestinations(res.destinations))
			.catch(console.error);

		apiFetch<{ programs: any[] }>(\\/catalog/programs\)
			.then(res => setCatalogPrograms(res.programs))
			.catch(console.error);
	}, []);
);

// Replace Institution
content = content.replace(
	{getLookupOptions('institution')},
	{catalogUnis.map(u => (<option key={u.id} value={u.name}>{u.name}</option>))}
);

// Replace Field of study
content = content.replace(
	{getLookupOptions('fieldOfStudy')},
	{Array.from(new Set(catalogPrograms.map(p => p.field).filter(Boolean))).map(f => (<option key={f} value={f}>{f}</option>))}
);

// Replace Preferred countries
content = content.replace(
	{getLookupOptions('preferredCountries')},
	{catalogDestinations.map(d => (<option key={d.id} value={d.name}>{d.name}</option>))}
);

// Replace Preferred field
content = content.replace(
	{getLookupOptions('preferredField')},
	{Array.from(new Set(catalogPrograms.map(p => p.field).filter(Boolean))).map(f => (<option key={f} value={f}>{f}</option>))}
);

fs.writeFileSync(file, content, 'utf8');
console.log('Patched PortalPages.tsx');
