import { OPS_BRANCHES } from "century-nit-core/ops";

/**
 * Branch filter for all-branch roles (manager, finance). Branch-scoped roles
 * (coordinator, consultant) never render this - their records are auto-scoped.
 */
export function BranchScopeFilter({
	value,
	onChange,
	label = "All Branches",
}: {
	value: string;
	onChange: (value: string) => void;
	label?: string;
}) {
	return (
		<select
			className="input"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			style={{ width: "auto" }}
			aria-label="Filter by branch"
		>
			<option value="all">{label}</option>
			{OPS_BRANCHES.map((b) => (
				<option key={b.id} value={b.id}>
					{b.name}
				</option>
			))}
		</select>
	);
}
