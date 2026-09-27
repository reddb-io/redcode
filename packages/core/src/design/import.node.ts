export const importModule = <T>(file: string): Promise<T> => import(file)
