/**
 * Runs a set of asynchronous tasks with a specified concurrency limit.
 * 
 * @param items The items to process
 * @param concurrencyLimit The maximum number of concurrent tasks
 * @param iteratorFn The async function to run for each item
 * @returns A promise that resolves to an array of results
 */
export async function runWithConcurrencyLimit<T, R>(
    items: T[],
    concurrencyLimit: number,
    iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const executors = new Set<Promise<void>>();

    for (let index = 0; index < items.length; index++) {
        const item = items[index];

        // Wrap the execution to store the result and clean up executors
        const promise = iteratorFn(item, index).then((result) => {
            results[index] = result;
        }).finally(() => {
            executors.delete(promise);
        });

        executors.add(promise);

        if (executors.size >= concurrencyLimit) {
            await Promise.race(executors);
        }
    }

    await Promise.all(executors);
    return results;
}
