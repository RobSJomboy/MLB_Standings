"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeIsVisibleFn = serializeIsVisibleFn;
exports.isInstanceBaseProps = isInstanceBaseProps;
function serializeIsVisibleFn(options) {
    return (options ?? []).map((option) => {
        if ('isVisible' in option) {
            if (typeof option.isVisible === 'function') {
                return {
                    ...option,
                    isVisibleFn: option.isVisible.toString(),
                    isVisible: undefined,
                };
            }
        }
        // ignore any existing `isVisibleFn` to avoid code injection
        return {
            ...option,
            isVisibleFn: undefined,
        };
    });
}
function isInstanceBaseProps(obj) {
    const obj2 = obj;
    return typeof obj2 === 'object' && typeof obj2.id === 'string' && obj2._isInstanceBaseProps === true;
}
//# sourceMappingURL=base.js.map