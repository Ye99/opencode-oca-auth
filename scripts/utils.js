export const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

export const clone = (value) => structuredClone(value)

export const toObject = (value) => (isObject(value) ? value : {})
