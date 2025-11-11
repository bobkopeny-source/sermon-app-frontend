function makeLinks(txt, segs) {
  const re = /\(\[(\d{1,2}:\d{2})\s+from\s+([^\]]+)\]\)/g;
  return txt.replace(re, (match, timestamp, dateStr) => {
    let seg = segs.find(s => s.timestamp === timestamp);
    if (!seg) seg = segs.find(s => s.date && s.date.includes(dateStr.trim()));
    if (!seg && segs.length > 0) seg = segs[0];
    return seg ? `<a href="${seg.url}" target="_blank" class="cite-link" title="Watch at ${timestamp}">([${timestamp} from ${dateStr}])</a>` : match;
  });
}
