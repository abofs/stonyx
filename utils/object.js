export function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function mergeObject(obj1, obj2) {
  if (Array.isArray(obj1) || Array.isArray(obj2)) throw new Error('Cannot merge arrays.');
  if (typeof obj1 !== 'object' || obj1 === null) return structuredClone(obj2);
  if (typeof obj2 !== 'object' || obj2 === null) return structuredClone(obj1);

  const result = {};
  const keys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

  for (const key of keys) {
    const val1 = obj1[key];
    const val2 = obj2[key];

    if (val2 === undefined) {
      result[key] = structuredClone(val1);
    } else if (val1 === undefined) {
      result[key] = structuredClone(val2);
    } else if (
      typeof val1 === 'object' &&
      typeof val2 === 'object' &&
      val1 !== null &&
      val2 !== null &&
      !Array.isArray(val1) &&
      !Array.isArray(val2)
    ) {
      result[key] = mergeObject(val1, val2);
    } else {
      result[key] = structuredClone(val2);
    }
  }

  return result;
}
