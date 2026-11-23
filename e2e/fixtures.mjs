// Uçtan uca duman testi için SENTETİK veri üretir. Yalnızca test içindir, uygulamaya gömülmez.
// Gerçek CelesTrak isteklerini yük bindirmemek için test sırasında ağ istekleri bu verilerle yanıtlanır.

const HEADER =
  'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';

const KINDS = [
  { tag: 'LEO', n: 15.2, e: 0.0012, inc: () => 40 + Math.random() * 58 },
  { tag: 'MEO', n: 2.0056, e: 0.008, inc: () => 55 },
  { tag: 'GEO', n: 1.00272, e: 0.0002, inc: () => 0.05 },
  { tag: 'HEO', n: 2.006, e: 0.72, inc: () => 63.4 },
];
const OWNERS = ['US', 'PRC', 'TURK', 'ESA', 'JPN', 'IND'];

export function makeFixtures(count = 400, now = Date.now()) {
  const epoch = new Date(now - 3_600_000).toISOString().replace('Z', '').replace(/\.(\d{3})$/, '.$1000');
  const rows = [HEADER];
  const satcat = [
    'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE',
  ];
  const groups = { stations: [], weather: [], gnss: [], starlink: [], science: [] };
  for (let i = 0; i < count; i++) {
    const k = i < 4 ? KINDS[i] : i % 10 === 0 ? KINDS[1 + (i % 3)] : KINDS[0];
    const id = 90000 + i;
    const name = `TEST ${k.tag} ${String(i + 1).padStart(3, '0')}`;
    const f = (v, d) => v.toFixed(d);
    rows.push(
      [name, `2026-${String(100 + (i % 800)).padStart(3, '0')}A`, epoch, f(k.n, 8), f(k.e, 7).replace(/^0/, ''), f(k.inc(), 4),
        f(Math.random() * 360, 4), f(Math.random() * 360, 4), f(Math.random() * 360, 4), 0, 'U', id, 999, 100, '.0001', '.00001', 0].join(','),
    );
    satcat.push(`${name},2026-001A,${id},PAY,+,${OWNERS[i % OWNERS.length]},2026-01-15,AFETR,,95,50,500,490,,,EA,ORB`);
    if (i === 0) groups.stations.push(id);
    else if (i % 10 === 1) groups.weather.push(id);
    else if (k.tag === 'MEO') groups.gnss.push(id);
    else if (i % 3 === 0) groups.starlink.push(id);
    else if (i % 7 === 0) groups.science.push(id);
  }
  const groupCsv = (ids) => [HEADER, ...rows.slice(1).filter((r) => ids.includes(Number(r.split(',')[11])))].join('\n');
  return {
    active: rows.join('\n'),
    satcat: satcat.join('\n'),
    group: (g) => (groups[g] ? groupCsv(groups[g]) : HEADER),
  };
}
