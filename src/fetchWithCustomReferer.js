const fetch = require('node-fetch');

/**
 * 带有自定义Referer和其他优化设置的fetch函数
 * 支持两种调用方式：
 * 1. 传统参数：fetchWithCustomReferer(url, referer, customHeaders, customTimeout, options)
 * 2. 对象参数：fetchWithCustomReferer(url, { referer, headers, timeout, ... })
 * @param {string} url - 目标URL
 * @param {string|Object} param1 - Referer字符串或配置对象
 * @param {Object} customHeaders - 自定义请求头(传统方式)
 * @param {number} customTimeout - 自定义超时时间(毫秒)(传统方式)
 * @param {Object} options - 其他选项(传统方式)
 * @returns {Promise} - 返回fetch响应
 */
async function fetchWithCustomReferer(url, param1 = {}, customHeaders = {}, customTimeout = null, options = {}) {
  // 解析参数
  let config = {};
  if (typeof param1 === 'string') {
    // 传统调用方式
    config.referer = param1;
    config.headers = customHeaders;
    config.timeout = customTimeout;
    config.options = options;
  } else {
    // 对象参数调用方式
    config = {
      referer: param1.referer,
      headers: param1.headers || {},
      timeout: param1.timeout || null,
      maxRetries: param1.maxRetries || 3,
      retryDelay: param1.retryDelay || 1000,
      options: param1
    };
  }
  // 增强的音频类型检测
  const isAudio = url.endsWith('.aac') || 
                 url.endsWith('.mp3') || 
                 url.endsWith('.m4a') || 
                 url.endsWith('.opus') || 
                 url.endsWith('.ogg') ||
                 url.includes('audio') ||
                 url.includes('sound');
  const isM3U8 = url.endsWith('.m3u8');
  
  // 根据文件类型设置默认超时，支持自定义超时参数
  // 音频文件需要更长的超时时间以确保完整加载
  const defaultTimeoutMs = isAudio ? 35000 : (isM3U8 ? 15000 : 20000);
  const timeoutMs = config.timeout || defaultTimeoutMs;

  // 实现重试逻辑
  let attempts = 0;
  const maxRetries = isAudio ? Math.max(config.maxRetries, 5) : config.maxRetries; // 为音频文件增加重试次数
  const retryDelay = isAudio ? Math.max(config.retryDelay, 800) : config.retryDelay; // 音频文件使用更长的重试间隔
  
  // 指数退避重试策略，但为音频文件调整参数
  const getRetryDelay = (attempt) => {
    const baseDelay = retryDelay;
    const factor = isAudio ? 1.8 : 2.0; // 音频文件使用更平缓的增长因子
    const jitter = Math.random() * 0.3 + 0.85; // 添加一些随机性(85%-115%)
    return Math.min(baseDelay * Math.pow(factor, attempt), 10000) * jitter; // 最大延迟10秒
  };
  
  while (attempts <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 基础请求头设置
      const baseHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': isAudio ? 'audio/*, */*;q=0.9' : '*/*',
        'Connection': 'keep-alive'
      };
      
      // 为音频文件添加特殊的请求头，确保更好的兼容性
      if (isAudio) {
        baseHeaders['Range'] = 'bytes=0-'; // 支持范围请求
        baseHeaders['Accept-Ranges'] = 'bytes';
        baseHeaders['Cache-Control'] = 'no-transform'; // 确保音频不被代理修改
      }
      
      // 添加可选的Referer
      if (config.referer) {
        baseHeaders['Referer'] = config.referer;
        baseHeaders['Origin'] = new URL(config.referer).origin;
      }
      
      // 增强HTTPS请求支持
      if (url.startsWith('https://')) {
        // 添加更多与HTTPS相关的头部
        baseHeaders['Upgrade-Insecure-Requests'] = '1';
        baseHeaders['Accept-Encoding'] = 'gzip, deflate, br';
      }
      
      // 合并自定义headers，自定义headers优先级更高
      const headers = {
        ...baseHeaders,
        ...config.headers
      };

      // 构建fetch选项
      const fetchOptions = {
        headers,
        signal: controller.signal,
        redirect: 'follow',
        compress: true, // 启用压缩以提高性能
        ...config.options
      };

      // 增加重试逻辑提示
      if (attempts > 0) {
        console.log(`重试请求 (${attempts}/${maxRetries}): ${url}, 超时设置: ${timeoutMs}ms`);
      }
      const response = await fetch(url, fetchOptions);

      clearTimeout(timeout);
      if (attempts === 0) {
        console.log(`请求成功完成: ${url}, 状态码: ${response.status}`);
      }
      return response;

    } catch (error) {
      clearTimeout(timeout);
      
      // 记录详细错误信息
      const errorType = error.name || 'UnknownError';
      const errorMessage = error.message || 'No error message';
      
      if (attempts >= maxRetries) {
        // 所有重试都失败了，创建一个包含详细信息的错误对象
        const fetchError = new Error(`请求失败 (${attempts}次尝试): ${url} - ${errorType}: ${errorMessage}`);
        fetchError.originalError = error;
        fetchError.url = url;
        fetchError.retryAttempts = attempts;
        fetchError.timeoutMs = timeoutMs;
        
        // 对不同类型的错误进行特殊处理
        if (errorType === 'AbortError') {
          fetchError.code = 'TIMEOUT';
          fetchError.message = `请求超时 (${timeoutMs/1000}s): ${url}`;
        }
        
        console.error(`请求最终失败: ${fetchError.message}`, {
          url: url,
          attempts: attempts,
          timeout: timeoutMs,
          errorType: errorType,
          originalMessage: errorMessage
        });
        
        throw fetchError;
      }
      
      attempts++;
      console.warn(`请求尝试 ${attempts}/${maxRetries} 失败: ${url}, 错误: ${errorMessage}`, {
        errorType: errorType,
        nextRetry: `${attempts < maxRetries ? '将在' + config.retryDelay + 'ms后重试' : '达到最大重试次数'}`
      });
      
      // 等待后重试，使用智能的指数退避策略
      if (attempts < maxRetries) {
        const delayMs = getRetryDelay(attempts);
        console.log(`将在 ${delayMs.toFixed(0)}ms 后重试 ${url}`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
}

module.exports = { fetchWithCustomReferer };
