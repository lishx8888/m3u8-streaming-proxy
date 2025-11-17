// 重写M3U8播放列表中的URL，将其转换为通过代理服务器访问的URL
/**
 * 重写M3U8播放列表中的URL为代理URL
 * @param {string} playlistContent - 原始M3U8播放列表内容
 * @param {string} baseUrl - 原始URL，用于解析相对路径
 * @param {string} [proxyBaseUrl] - 代理基础URL，默认为'/api/v1/proxy?url='
 * @returns {string} - 重写后的播放列表内容
 */
function rewritePlaylistUrls(playlistContent, baseUrl, proxyBaseUrl = '/api/v1/proxy?url=') {
  // 输入验证，防止TypeError异常
  if (!playlistContent || typeof playlistContent !== 'string') {
    console.error('🔴 播放列表内容无效或为空:', typeof playlistContent);
    return '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST';
  }
  
  if (!baseUrl || typeof baseUrl !== 'string') {
    console.error('🔴 原始URL无效或为空:', typeof baseUrl);
    return playlistContent; // 至少返回原始内容
  }
  
  try {
    // 解析基础URL，构建完整的基础路径
    let baseUrlObj;
    try {
      baseUrlObj = new URL(baseUrl);
    } catch (urlError) {
      console.error('🔴 无效的URL格式:', baseUrl, urlError.message);
      return playlistContent;
    }
    
    // 构建完整的基础URL（包含路径部分，不只是域名）
    const pathParts = baseUrlObj.pathname.split('/');
    pathParts.pop(); // 移除文件名
    const normalizedBaseUrl = baseUrlObj.origin + pathParts.join('/') + '/';
    
    // 确保proxyBaseUrl不以斜杠结尾且不重复添加'?url='
    let normalizedProxyBase = proxyBaseUrl;
    if (!normalizedProxyBase.includes('?url=')) {
      normalizedProxyBase = normalizedProxyBase.endsWith('/') 
        ? `${normalizedProxyBase}?url=` 
        : `${normalizedProxyBase}?url=`;
    }
    
    // 检测是否为直播流（通常没有EXT-X-ENDLIST标记）
    const isLiveStream = !playlistContent.includes('#EXT-X-ENDLIST');
    
    // 构建代理URL函数
    const createProxyUrl = (targetUrl, originalIndent = '') => {
      // 检查是否已经是代理URL，如果是则不再处理（避免递归代理）
      if (targetUrl.includes('?url=')) {
        return originalIndent + targetUrl;
      }
      
      try {
        // 绝对URL（http/https）
        if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
          return originalIndent + normalizedProxyBase + encodeURIComponent(targetUrl);
        }

        // 相对URL处理
        let absoluteUrl;
        
        // 根相对路径（以/开头）
        if (targetUrl.startsWith('/')) {
          absoluteUrl = baseUrlObj.origin + targetUrl;
        } 
        // 普通相对路径
        else {
          try {
            // 使用URL构造函数精确解析相对路径
            absoluteUrl = new URL(targetUrl, normalizedBaseUrl).href;
          } catch (urlError) {
            // 降级处理：简单拼接
            absoluteUrl = normalizedBaseUrl + targetUrl;
            console.warn('⚠️  降级处理相对路径:', targetUrl, '->', absoluteUrl);
          }
        }
        
        return originalIndent + normalizedProxyBase + encodeURIComponent(absoluteUrl);
      } catch (error) {
        console.warn('⚠️  重写URL失败:', targetUrl, error.message);
        return originalIndent + targetUrl; // 失败时返回原始URL
      }
    };
    
    // 使用更稳健的行分割方法，支持CRLF和LF换行符
    const rewrittenLines = playlistContent
      .split(/\r?\n/)
      .map(line => {
        // 保存原始缩进和空白字符，只处理实际内容
        const originalIndent = line.match(/^\s*/)[0];
        const content = line.trim();
        
        // 跳过空行，但保留它们
        if (content === '') {
          return line;
        }

        // 处理注释行
        if (content.startsWith('#')) {
          // 对于EXTINF行，需要特殊处理后面的URL
          if (content.startsWith('#EXTINF:')) {
            // 匹配EXTINF行格式：#EXTINF:duration,title
            const extinfMatch = content.match(/^#EXTINF:([^,]+),(.*)$/);
            if (extinfMatch && extinfMatch[2]) {
              const title = extinfMatch[2];
              // 如果title看起来像URL，则进行代理处理
              if (title && !title.startsWith('#') && 
                  (title.includes('.ts') || title.includes('.m3u8') || 
                   title.includes('.aac') || !title.includes(' '))) {
                return originalIndent + `#EXTINF:${extinfMatch[1]},` + createProxyUrl(title, '');
              }
            }
          }
          return line;
        }

        // 处理媒体文件URL
        if (content.includes('.ts') || content.includes('.m3u8') || 
            content.includes('.aac') || content.includes('.mp3') || 
            content.includes('.m4s') || content.includes('.key') ||
            content.includes('.crypt') || content.includes('.vtt') ||
            content.includes('.mp4') || content.includes('.ogg') ||
            content.includes('.opus')) {
          return createProxyUrl(content, originalIndent);
        }

        // 其他行可能也是URL，尝试处理
        return createProxyUrl(content, originalIndent);
      });
    
    // 合并重写后的行，使用标准换行符
    let result = rewrittenLines.join('\n');
    
    // 确保播放列表以#EXTM3U开头
    if (!result.trim().startsWith('#EXTM3U')) {
      console.warn('⚠️  修改后的播放列表不包含#EXTM3U标签，添加最小有效头部');
      result = '#EXTM3U\n' + result;
    }
    
    // 对于直播流，确保没有意外的ENDLIST标记
    if (isLiveStream && result.includes('#EXT-X-ENDLIST')) {
      // 如果直播流中错误地包含了ENDLIST，移除它
      result = result.replace(/#EXT-X-ENDLIST\s*/g, '');
    }
    
    // 过滤掉多余的空行，但保留格式
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
  } catch (error) {
    console.error('🔴 重写播放列表URL时发生错误:', error.message);
    console.error('🔴 错误堆栈:', error.stack);
    
    // 确保在任何情况下都返回有效的播放列表
    try {
      if (!playlistContent.trim().startsWith('#EXTM3U')) {
        return '#EXTM3U\n' + playlistContent;
      }
      return playlistContent;
    } catch (finalError) {
      // 最后的安全网，确保返回有效的最小播放列表
      return '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST';
    }
  }
}

module.exports = rewritePlaylistUrls;
