/**
 * 统一响应格式
 */

/**
 * 成功响应
 */
const success = (res, data = null, message = 'Success') => {
    return res.status(200).json({
        code: 0,
        message,
        data,
    });
};

/**
 * 创建成功
 */
const created = (res, data = null, message = 'Created') => {
    return res.status(201).json({
        code: 0,
        message,
        data,
    });
};

/**
 * 错误响应
 */
const error = (res, message = 'Error', code = -1, statusCode = 400) => {
    return res.status(statusCode).json({
        code,
        message,
        data: null,
    });
};

/**
 * 未授权
 */
const unauthorized = (res, message = 'Unauthorized') => {
    return error(res, message, -401, 401);
};

/**
 * 禁止访问
 */
const forbidden = (res, message = 'Forbidden') => {
    return error(res, message, -403, 403);
};

/**
 * 未找到
 */
const notFound = (res, message = 'Not Found') => {
    return error(res, message, -404, 404);
};

/**
 * 服务器错误
 */
const serverError = (res, message = 'Internal Server Error') => {
    return error(res, message, -500, 500);
};

/**
 * 参数错误
 */
const badRequest = (res, message = 'Bad Request') => {
    return error(res, message, -400, 400);
};

/**
 * 余额不足
 */
const insufficientBalance = (res, message = 'Insufficient Balance') => {
    return error(res, message, -1001, 400);
};

/**
 * 业务错误
 */
const businessError = (res, message = 'Business Error') => {
    return error(res, message, -2000, 400);
};

module.exports = {
    success,
    created,
    error,
    unauthorized,
    forbidden,
    notFound,
    serverError,
    badRequest,
    insufficientBalance,
    businessError,
};
