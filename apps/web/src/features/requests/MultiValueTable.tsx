import type { MultiValueMap } from '../../lib/types';

export function MultiValueTable({ values }: { values: MultiValueMap }) {
  // JSONB no conserva el orden de las claves: se muestran ordenadas por nombre.
  const rows = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, list]) =>
      list.map((value, index) => ({ key: `${name}#${index}`, name, value })),
    );

  if (rows.length === 0) return <p className="text-sm text-zinc-500">Sin valores</p>;

  return (
    <table className="w-full table-fixed text-sm">
      <tbody className="divide-y divide-zinc-800/80">
        {rows.map((row) => (
          <tr key={row.key}>
            <th
              scope="row"
              className="w-2/5 py-1.5 pr-4 text-left align-top font-mono font-normal break-all text-zinc-400"
            >
              {row.name}
            </th>
            <td className="py-1.5 font-mono break-all text-zinc-200">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
