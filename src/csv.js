export function rowsToCsv(rows) {
  const headers = [
    'Nation',
    'Population (millions)',
    'Faction',
    'Support (%)',
    'Supporters (millions)',
    'Influence / year',
    'Influence / month',
    'Influence / month per 1 pp',
    'Government',
    'Cohesion',
    'Unrest',
    'Control point owners',
  ];

  const body = rows.map(row => [
    row.nationName,
    row.populationMillions,
    row.factionName,
    row.supportPercent,
    row.supportersMillions,
    row.annualInfluence,
    row.monthlyInfluence,
    row.monthlyInfluencePerPercentagePoint,
    row.government ?? '',
    row.cohesion ?? '',
    row.unrest ?? '',
    row.controlPointOwners.join(' | '),
  ]);

  return [headers, ...body].map(record => record.map(csvCell).join(',')).join('\n');
}

export function downloadText(content, fileName, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
