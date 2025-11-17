const express = require('express');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');
const { fetchWithCustomReferer } = require('./fetchWithCustomReferer');
const rewritePlaylistUrls = require('./utils/rewritePlaylistUrls');
const NodeCache = require('node-cache');
const morgan = require('morgan');
const helmet = require('helmet');
const { cleanEnv, str, num } = require('envalid');

const env = cleanEnv(process.env, {
  PORT: num({ default: 3000 }),
  ALLOWED_ORIGINS: str({ default: "*" }),
  REFERER_URL: str({ default: "https://www.ximalaya.com/" })
});

const app = express();

// 移除强制HTTP重定向，允许HTTPS请求直接处理
// 本地开发环境可以同时支持HTTP和HTTPS

const PORT = env.PORT;
const cache = new NodeCache({ stdTTL: 31536000 });

app.use(morgan('dev'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "http:", "https:"],
      mediaSrc: ["'self'", "blob:", "http:", "https:"],
      connectSrc: ["'self'", "http:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      // 添加worker-src指令，允许blob: URL以支持HLS.js的Web Worker
      workerSrc: ["'self'", "blob:"],
      // 明确禁用upgradeInsecureRequests，避免强制HTTPS转换
      upgradeInsecureRequests: null
    }
  },
  hsts: false,
  noSniff: true,
  xssFilter: false
}));

// 移除错误的CSP中间件

app.use(express.static(path.join(__dirname, '../public')));

// 增强的CORS中间件，确保在HTTP/HTTPS混合环境下正常工作
app.use((req, res, next) => {
  // 明确设置允许所有来源
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 允许更多HTTP方法
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  // 扩展允许的头部
  res.setHeader('Access-Control-Allow-Headers', 
    'Origin, X-Requested-With, Content-Type, Cache-Control, Pragma, Range, Accept, Referer');
  // 设置预检请求的缓存时间
  res.setHeader('Access-Control-Max-Age', '86400');
  // 允许暴露特定响应头
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Cache-Control');
  
  // 正确处理预检请求
  if (req.method === 'OPTIONS') {
    console.log('处理CORS预检请求:', req.url);
    return res.status(204).end(); // 204 No Content 更适合OPTIONS请求
  }
  
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 处理直接的媒体片段请求（如 .m3u8, .ts, .aac 等）
app.get('/api/v1/:filename*', async (req, res, next) => {
  // 排除特定端点，让它们由专门的路由处理
  if (['streamingProxy', 'proxy'].includes(req.params.filename)) {
    return next();
  }
  
  console.log(`收到直接媒体请求: ${req.url}`);
  
  try {
    // 检查是否有URL参数，如果有则使用它（兼容现有喜马拉雅）
    let targetUrl = req.query.url;
    
    // 如果没有url参数，这是一个直接的媒体文件请求
    // 对于直接的媒体请求，我们需要从请求路径推断目标URL
    if (!targetUrl) {
      // 获取完整的请求路径（包括查询参数）
      const fullPath = req.originalUrl;
      
      // 从请求路径构建目标URL - 这里假设媒体文件是直接可访问的
      // 我们需要从路径中提取文件名和参数，并构建合理的目标URL
      // 例如：/api/v1/01.m3u8?param=value -> 直接使用这个路径作为媒体访问路径
      
      console.log(`处理直接媒体文件请求: ${fullPath}`);
      
      // 对于直接的媒体文件请求，我们可以有几种处理方式：
      // 1. 如果有referer，尝试从referer中提取原始URL
      // 2. 或者尝试访问一个默认的媒体服务器
      // 3. 最安全的方式是将请求转发到通用代理端点
      
      // 方式1：尝试使用referer中的信息（如果有）
      let baseUrl = 'http://localhost';
      if (req.headers.referer) {
        try {
          const refererUrl = new URL(req.headers.referer);
          baseUrl = `${refererUrl.protocol}//${refererUrl.host}`;
        } catch (e) {
          console.warn('Invalid referer URL:', e.message);
        }
      }
      
      // 构建目标URL - 这里简化处理，直接使用请求路径中的文件名部分
      // 注意：在实际生产环境中，可能需要更复杂的URL映射逻辑
      const pathParts = req.originalUrl.split('/api/v1/');
      if (pathParts.length > 1) {
        const mediaPath = pathParts[1];
        // 对于.m3u8, .ts, .aac等媒体文件，我们直接构建一个可能的目标URL
        // 这里只是一个简单的实现，实际可能需要更复杂的逻辑
        
        // 为了兼容性，我们暂时将请求转发到通用代理端点处理
        // 或者我们可以根据请求参数构建一个合理的目标URL
        console.log(`尝试处理媒体文件: ${mediaPath}`);
        
        // 对于这种直接媒体请求，我们可以：
        // 1. 使用缓存中的映射（如果有）
        // 2. 或者使用一个简单的策略来处理
        
        // 由于没有明确的目标URL，我们需要通知客户端需要提供url参数
        // 但为了更好的兼容性，我们可以尝试一个默认的处理方式
        
        // 对于.m3u8文件，我们可以尝试返回一个简单的播放列表，但包含必要的HLS标签
        if (req.params.filename.endsWith('.m3u8')) {
          res.set({"Content-Type": "application/vnd.apple.mpegurl"});
          return res.send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST`);
        }
        
        // 对于其他媒体文件，返回400错误并要求提供url参数
        return res.status(400).json({
          error: "Missing URL parameter",
          message: "直接的媒体文件请求需要通过url参数指定目标URL"
        });
      }
      
      // 如果无法构建有效的路径，返回错误
      return res.status(400).json({
        error: "Invalid request path",
        message: "无法从请求路径构建有效的媒体URL"
      });
    }
    
    // 验证并清理目标URL
    if (typeof targetUrl !== 'string' || !targetUrl) {
      console.error('无效的目标URL');
      return res.status(400).json({
        error: "Invalid URL",
        message: "提供的URL参数无效"
      });
    }
    
    // 确保URL格式正确，添加协议前缀如果缺少
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      console.warn('URL缺少协议前缀，尝试添加http://');
      targetUrl = 'http://' + targetUrl;
    }
    
    console.log(`处理目标URL: ${targetUrl}`);
    
    // 检测是否为m3u8文件
    const isM3U8 = targetUrl.endsWith('.m3u8') || req.params.filename.endsWith('.m3u8');
    const isLiveStream = targetUrl.includes('live') || targetUrl.includes('stream') || req.query.live === 'true';
    
    // 设置适当的缓存控制头
    if (isLiveStream) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    } else if (isM3U8) {
      res.setHeader('Cache-Control', 'public, max-age=5');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=30');
    }
    
    // 处理m3u8文件特殊逻辑
    if (isM3U8) {
      const response = await fetchWithCustomReferer(targetUrl, {
        timeout: 10000,
        maxRetries: 3,
        retryDelay: 500,
        headers: {
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          ...req.headers
        }
      });
      
      try {
        const playlistText = await response.text();
        
        // 确保playlistText是字符串且不为空
        if (typeof playlistText !== 'string' || !playlistText) {
          console.warn('⚠️ 无效的播放列表内容，返回最小有效播放列表');
          const minimalPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
          res.set({"Content-Type": "application/vnd.apple.mpegurl"});
          return res.send(minimalPlaylist);
        }
        
        // 安全地调用rewritePlaylistUrls并捕获任何异常
          let modifiedPlaylist;
          try {
            // 构建完整的代理基础URL（包含协议和域名）
            const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
            const host = req.headers.host;
            const proxyBaseUrl = `${protocol}://${host}/api/v1/proxy?url=`;
            
            console.log(`构建完整代理URL: ${proxyBaseUrl}`);
            
            // 使用完整的代理URL调用重写函数
            modifiedPlaylist = rewritePlaylistUrls(playlistText, targetUrl, proxyBaseUrl);
            
            // 验证重写后的内容是否有效
            if (!modifiedPlaylist || typeof modifiedPlaylist !== 'string' || !modifiedPlaylist.startsWith('#EXTM3U')) {
              console.warn('⚠️ 重写后的播放列表无效，使用原始内容');
              modifiedPlaylist = playlistText;
            }
          } catch (rewriteError) {
            console.error('🔴 播放列表重写失败:', rewriteError.message);
            // 如果重写失败，返回一个最小的有效播放列表
            modifiedPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
          }
        
        res.set({"Content-Type": "application/vnd.apple.mpegurl"});
        return res.send(modifiedPlaylist);
      } catch (contentError) {
        console.error('🔴 处理播放列表内容时出错:', contentError.message);
        // 错误降级处理
        res.set({"Content-Type": "application/vnd.apple.mpegurl"});
        return res.send('#EXTM3U\n#EXT-X-ENDLIST');
      }
    }
    
    // 处理媒体片段
    const response = await fetchWithCustomReferer(targetUrl, {
      timeout: isLiveStream ? 15000 : 10000,
      maxRetries: isLiveStream ? 5 : 3,
      retryDelay: 500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        ...req.headers
      }
    });
    
    // 设置响应头
    Object.keys(response.headers).forEach(key => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });
    
    // 流式传输响应
    response.body.pipe(res);
  } catch (error) {
    console.error('媒体片段请求错误:', error);
    res.status(500).send('Media playback error');
  }
});

// 添加通用代理端点 /api/v1/proxy
app.get('/api/v1/proxy', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ error: "URL parameter is required" });
    }

    const isM3U8 = targetUrl.endsWith(".m3u8");
    const isLiveStream = targetUrl.includes('live') || targetUrl.includes('stream') || req.query.live === 'true';
    
    // 设置适当的缓存控制头
    if (isLiveStream) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    } else if (isM3U8) {
      res.setHeader('Cache-Control', 'public, max-age=5');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=30');
    }

    // 处理m3u8文件特殊逻辑
    if (isM3U8) {
      const response = await fetchWithCustomReferer(targetUrl, {
        headers: {
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000,  // 添加明确的超时时间
        maxRetries: 3
      });
      
      try {
        const playlistText = await response.text();
        
        // 确保playlistText是字符串且不为空
        if (typeof playlistText !== 'string' || !playlistText) {
          console.warn('⚠️ 无效的播放列表内容，返回最小有效播放列表');
          const minimalPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
          res.set({"Content-Type": "application/vnd.apple.mpegurl"});
          return res.send(minimalPlaylist);
        }
        
        // 安全地调用rewritePlaylistUrls并捕获任何异常
          let modifiedPlaylist;
          try {
            // 构建完整的代理基础URL（包含协议和域名）
            const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
            const host = req.headers.host;
            const proxyBaseUrl = `${protocol}://${host}/api/v1/proxy?url=`;
            
            console.log(`构建完整代理URL: ${proxyBaseUrl}`);
            
            // 使用完整的代理URL调用重写函数
            modifiedPlaylist = rewritePlaylistUrls(playlistText, targetUrl, proxyBaseUrl);
            
            // 验证重写后的内容是否有效
            if (!modifiedPlaylist || typeof modifiedPlaylist !== 'string' || !modifiedPlaylist.startsWith('#EXTM3U')) {
              console.warn('⚠️ 重写后的播放列表无效，使用原始内容');
              modifiedPlaylist = playlistText;
            }
          } catch (rewriteError) {
            console.error('🔴 播放列表重写失败:', rewriteError.message);
            // 如果重写失败，返回一个最小的有效播放列表
            modifiedPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
          }
        
        res.set({"Content-Type": "application/vnd.apple.mpegurl"});
        return res.send(modifiedPlaylist);
      } catch (contentError) {
        console.error('🔴 处理播放列表内容时出错:', contentError.message);
        // 错误降级处理
        res.set({"Content-Type": "application/vnd.apple.mpegurl"});
        return res.send('#EXTM3U\n#EXT-X-ENDLIST');
      }
    }
    
    // 处理媒体片段和其他资源
    const response = await fetchWithCustomReferer(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        ...req.headers
      }
    });
    
    // 设置响应头
    Object.keys(response.headers).forEach(key => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });
    
    // 流式传输响应
    response.body.pipe(res);
  } catch (error) {
    console.error('代理请求错误:', error);
    res.status(500).json({ error: 'Proxy request failed', details: error.message });
  }
});

app.get('/api/v1/streamingProxy', async (req, res) => {
  try {
    // 检查是否有URL参数，如果有则使用它（兼容现有喜马拉雅）
    let targetUrl = req.query.url;
      console.log(`收到代理请求: ${targetUrl}`);
    // 如果没有url参数，这是一个直接的媒体文件请求
    // 对于直接的媒体请求，我们需要从请求路径推断目标URL
    if (!targetUrl) {
      // 获取完整的请求路径（包括查询参数）
      const fullPath = req.originalUrl;
      
      console.log(`处理直接媒体文件请求: ${fullPath}`);
      
      // 对于streamingProxy端点，我们应该处理各种媒体请求
      // 检查请求是否来自播放列表或媒体片段请求
      const isM3U8Request = req.headers.accept && req.headers.accept.includes('application/vnd.apple.mpegurl');
      
      if (isM3U8Request) {
        res.set({"Content-Type": "application/vnd.apple.mpegurl"});
        return res.send(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-ENDLIST`);
      }
      
      // 对于其他媒体文件，返回400错误并要求提供url参数
      return res.status(400).json({
        error: "Missing URL parameter",
        message: "请确保请求中包含有效的url参数"
      });
    }

    const isM3U8 = targetUrl.endsWith(".m3u8");
    const isLiveStream = targetUrl.includes('live') || targetUrl.includes('stream') || req.query.live === 'true';

    // === 原有m3u8处理：实时流优化 ===
    if (isM3U8) {
      let attempts = 0;
      const maxAttempts = 3;
      let response;
      while (attempts < maxAttempts) {
        try {
          // 添加自定义头信息以支持长连接
          const headers = {
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
          };
          response = await fetchWithCustomReferer(targetUrl, { headers });
          if (response.ok) break;
        } catch (err) {
          attempts++;
          console.warn(`m3u8 attempt ${attempts} failed:`, err.message);
          if (attempts >= maxAttempts) {
            const cached = cache.get(targetUrl + "_fallback");
            if (cached) {
              console.log("Using fallback m3u8");
              res.set({
                "Content-Type": "application/vnd.apple.mpegurl",
                "Cache-Control": "no-cache"
              });
              return res.send(cached);
            }
            throw err;
          }
          await new Promise(r => setTimeout(r, 500 * attempts));
        }
      }

      try {
        const playlistText = await response.text();
        
        // 确保playlistText是字符串且不为空
        if (typeof playlistText !== 'string' || !playlistText) {
          console.warn('⚠️ 无效的播放列表内容，返回最小有效播放列表');
          const minimalPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
          
          // 为实时流设置较短的缓存时间
          const cacheTTL = isLiveStream ? 5 : 30;
          cache.set(targetUrl + "_fallback", minimalPlaylist, cacheTTL);
          
          console.log(`是否为实时流: ${isLiveStream}`);
          // 实时流不缓存，普通流可以适当缓存
          if (isLiveStream) {
            console.log('设置实时流缓存控制头');
            res.set({
                "Content-Type": "application/vnd.apple.mpegurl",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
                "Connection": "keep-alive",
                "X-Content-Type-Options": "nosniff",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*"
              });
          } else {
            console.log('设置普通内容缓存控制头');
            res.set({
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "public, max-age=10"
            });
          }
          return res.send(minimalPlaylist);
        }
        
        // 安全地调用rewritePlaylistUrls并捕获任何异常
        let modifiedPlaylist;
        try {
          // 构建完整的代理基础URL（包含协议和域名）
          const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
          const host = req.headers.host;
          const proxyBaseUrl = `${protocol}://${host}/api/v1/proxy?url=`;
          
          console.log(`构建完整代理URL: ${proxyBaseUrl}`);
          
          // 使用完整的代理URL调用重写函数
          modifiedPlaylist = rewritePlaylistUrls(playlistText, targetUrl, proxyBaseUrl);
          // 验证重写后的内容是否有效
          if (!modifiedPlaylist || typeof modifiedPlaylist !== 'string' || !modifiedPlaylist.startsWith('#EXTM3U')) {
            console.warn('⚠️ 重写后的播放列表无效，使用原始内容');
            modifiedPlaylist = playlistText;
          }
        } catch (rewriteError) {
          console.error('🔴 播放列表重写失败:', rewriteError.message);
          // 如果重写失败，返回一个最小的有效播放列表
          modifiedPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
        }
        
        // 为实时流设置较短的缓存时间
        const cacheTTL = isLiveStream ? 5 : 30;
        cache.set(targetUrl + "_fallback", modifiedPlaylist, cacheTTL);
        
        console.log(`是否为实时流: ${isLiveStream}`);
        // 实时流不缓存，普通流可以适当缓存
        if (isLiveStream) {
          console.log('设置实时流缓存控制头');
          res.set({
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache",
              "Expires": "0",
              "Connection": "keep-alive",
              "X-Content-Type-Options": "nosniff",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Access-Control-Allow-Headers": "*"
            });
        } else {
          console.log('设置普通内容缓存控制头');
          res.set({
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "public, max-age=10"
          });
        }
        return res.send(modifiedPlaylist);
      } catch (contentError) {
        console.error('🔴 处理播放列表内容时出错:', contentError.message);
        // 错误降级处理
        const fallbackPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
        res.set({
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        });
        return res.send(fallbackPlaylist);
      }
    }

    // === 媒体片段处理：区分实时流和普通内容 ===
    // 对于实时流，不使用缓存
    if (isLiveStream) {
      let attempts = 0;
      const maxAttempts = 5; // 增加重试次数以提高稳定性
      let response;
      while (attempts < maxAttempts) {
        try {
          const headers = {
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Accept-Encoding': 'identity' // 避免压缩以减少延迟
          };
          console.log(`正在请求实时流目标URL: ${targetUrl}`);
          console.log('请求头:', JSON.stringify(headers, null, 2));
          // 为实时流设置更长的超时时间
          response = await fetchWithCustomReferer(targetUrl, { referer: env.REFERER_URL, headers: headers, timeout: 15000 });
          console.log(`目标响应状态: ${response.status}`);
          if (response.ok) break;
        } catch (err) {
          attempts++;
          console.warn(`Live stream segment attempt ${attempts} failed:`, err.message);
          if (attempts >= maxAttempts) {
            // 实时流失败时返回空片段而不是静音，让播放器可以继续请求新内容
            const emptySegment = Buffer.alloc(16);
            // 增强的内容类型检测
            let contentType = '';
            if (targetUrl.endsWith('.ts')) {
              contentType = 'video/mp2t';
            } else if (targetUrl.endsWith('.aac') || 
                      targetUrl.includes('audio') || 
                      targetUrl.includes('sound')) {
              contentType = 'audio/aac';
            } else if (targetUrl.endsWith('.mp3')) {
              contentType = 'audio/mpeg';
            } else {
              contentType = 'application/octet-stream';
            }
            res.set({
              "Content-Type": contentType,
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            });
            return res.send(emptySegment);
          }
          // 指数退避但更快的重试策略
          await new Promise(r => setTimeout(r, 200 * Math.pow(1.5, attempts)));
        }
      }

      // 实时流使用流式传输 - 增强的音频内容类型检测
      let contentType = '';
      
      // 增强的音频格式检测逻辑
      // 1. 首先检测是否为音频相关URL（更全面的关键词匹配）
      const isAudioUrl = 
        targetUrl.includes('audio') || 
        targetUrl.includes('sound') || 
        targetUrl.includes('voice') || 
        targetUrl.includes('audio_') || 
        targetUrl.includes('audio/') || 
        targetUrl.includes('_audio') ||
        targetUrl.includes('mp3') || 
        targetUrl.includes('aac') || 
        targetUrl.includes('m4a') || 
        targetUrl.includes('opus') || 
        targetUrl.includes('ogg');
      
      // 2. 根据文件扩展名和URL特征综合判断
      if (targetUrl.endsWith('.ts')) {
        // .ts文件可能包含视频或音频
        // 如果URL中包含音频相关关键词，则优先识别为音频
        contentType = isAudioUrl ? 'audio/mp2t' : 'video/mp2t';
      } else if (targetUrl.endsWith('.aac')) {
        contentType = 'audio/aac';
      } else if (targetUrl.endsWith('.mp3')) {
        contentType = 'audio/mpeg';
      } else if (targetUrl.endsWith('.m4a')) {
        contentType = 'audio/mp4';
      } else if (targetUrl.endsWith('.opus')) {
        contentType = 'audio/opus';
      } else if (targetUrl.endsWith('.ogg')) {
        contentType = 'audio/ogg';
      } else if (targetUrl.endsWith('.mp4')) {
        // MP4文件可能是视频或纯音频
        contentType = isAudioUrl ? 'audio/mp4' : 'video/mp4';
      } else if (isAudioUrl) {
        // 对于明确是音频的URL，但没有常见扩展名
        contentType = 'audio/aac';
      } else {
        // 如果扩展名和URL模式无法判断，尝试从响应头获取
      contentType = response.headers.get('content-type');
      // 如果响应头也没有有效的content-type，尝试根据内容特征判断
      if (!contentType || contentType === 'application/octet-stream') {
        // 设置默认的内容类型，优先考虑音频格式
        contentType = isAudioUrl ? 'audio/aac' : 'application/octet-stream';
      }
    }
    
    // 确保内容类型始终有效
    if (!contentType || contentType === '') {
      contentType = isAudioUrl ? 'audio/aac' : 'application/octet-stream';
    }
    
    // 确保在所有情况下都设置响应头
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // 禁用代理缓冲，减少延迟
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    });
      console.log('开始流式传输响应数据');
      
      // 优化流传输，增加错误处理
      response.body.on('error', (err) => {
        console.error('实时流传输错误:', err);
      });
      
      // 设置更高的缓冲区大小以提高流畅度
      response.body.pipe(res);
      return;
    }

    // 普通媒体片段：使用缓存
    // 对于PHP脚本URL，添加时间戳作为缓存键的一部分，避免无限缓存动态内容
    const cacheKey = targetUrl.includes('.php') ? 
                    `${targetUrl}_${Math.floor(Date.now() / 300000)}` : // 5分钟缓存键
                    targetUrl;
    
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) {
      console.log(`Serving from cache: ${targetUrl}`);
      // 增强的内容类型检测
      // 1. 首先检测是否为音频相关URL（更全面的关键词匹配）
      const isAudioUrl = 
        targetUrl.includes('audio') || 
        targetUrl.includes('sound') || 
        targetUrl.includes('voice') || 
        targetUrl.includes('audio_') || 
        targetUrl.includes('audio/') || 
        targetUrl.includes('_audio') ||
        targetUrl.includes('mp3') || 
        targetUrl.includes('aac') || 
        targetUrl.includes('m4a') || 
        targetUrl.includes('opus') || 
        targetUrl.includes('ogg');
      
      let contentType;
      if (targetUrl.includes('php')) {
        contentType = 'application/vnd.apple.mpegurl';
      } else if (targetUrl.endsWith('.ts')) {
        // .ts文件可能包含视频或音频
        contentType = isAudioUrl ? 'audio/mp2t' : 'video/mp2t';
      } else if (targetUrl.endsWith('.aac')) {
        contentType = 'audio/aac';
      } else if (targetUrl.endsWith('.mp3')) {
        contentType = 'audio/mpeg';
      } else if (targetUrl.endsWith('.m4a')) {
        contentType = 'audio/mp4';
      } else if (targetUrl.endsWith('.opus')) {
        contentType = 'audio/opus';
      } else if (targetUrl.endsWith('.ogg')) {
        contentType = 'audio/ogg';
      } else if (targetUrl.endsWith('.mp4')) {
        // MP4文件可能是视频或纯音频
        contentType = isAudioUrl ? 'audio/mp4' : 'video/mp4';
      } else if (isAudioUrl) {
        // 对于明确是音频的URL，但没有常见扩展名
        contentType = 'audio/aac';
      } else {
        contentType = 'application/octet-stream';
      }
      res.set({
        "Content-Type": contentType,
        "Cache-Control": targetUrl.includes('php') ? "no-cache, max-age=0" : "public, max-age=7200" // 对PHP脚本禁用缓存
      });
      return res.send(cachedResponse);
    }

    let attempts = 0;
    const maxAttempts = 3;
    let response;
    while (attempts < maxAttempts) {
      try {
        console.log(`正在请求目标URL: ${targetUrl}`);
        // 非实时流使用更长的超时时间
        response = await fetchWithCustomReferer(targetUrl, { referer: env.REFERER_URL, headers: {}, timeout: 20000 });
        console.log(`目标响应状态: ${response.status}`);
        if (response.ok) break;
      } catch (err) {
        attempts++;
        console.warn(`Segment attempt ${attempts} failed:`, err.message);
        if (attempts >= maxAttempts) {
          const silentAAC = Buffer.from([
            0xFF, 0xF1, 0x50, 0x80, 0x00, 0x1F, 0xFC, 0x21,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
          ]);
          cache.set(targetUrl, silentAAC, 60);
          res.set({
            "Content-Type": "audio/aac",
            "Cache-Control": "public, max-age=60"
          });
          return res.send(silentAAC);
        }
        // 更合理的重试间隔
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempts)));
      }
    }

    // 使用流式处理大型响应以提高性能
    // 增强的内容类型检测，添加更多音频格式支持和URL模式匹配
    // 1. 首先检测是否为音频相关URL（更全面的关键词匹配）
    const isAudioUrl = 
      targetUrl.includes('audio') || 
      targetUrl.includes('sound') || 
      targetUrl.includes('voice') || 
      targetUrl.includes('audio_') || 
      targetUrl.includes('audio/') || 
      targetUrl.includes('_audio') ||
      targetUrl.includes('mp3') || 
      targetUrl.includes('aac') || 
      targetUrl.includes('m4a') || 
      targetUrl.includes('opus') || 
      targetUrl.includes('ogg');
    
    let contentType = '';
    
    // 首先根据URL模式和扩展名综合判断
    if (targetUrl.endsWith('.ts')) {
      // .ts文件可能包含视频或音频
      contentType = isAudioUrl ? 'audio/mp2t' : 'video/mp2t';
    } else if (targetUrl.endsWith('.aac')) {
      contentType = 'audio/aac';
    } else if (targetUrl.endsWith('.mp3')) {
      contentType = 'audio/mpeg';
    } else if (targetUrl.endsWith('.m4a')) {
      contentType = 'audio/mp4';
    } else if (targetUrl.endsWith('.opus')) {
      contentType = 'audio/opus';
    } else if (targetUrl.endsWith('.ogg')) {
      contentType = 'audio/ogg';
    } else if (targetUrl.endsWith('.mp4')) {
      // MP4文件可能是视频或纯音频
      contentType = isAudioUrl ? 'audio/mp4' : 'video/mp4';
    } else if (isAudioUrl) {
      // 对于明确是音频的URL，但没有常见扩展名
      contentType = 'audio/aac';
    } else if (targetUrl.includes('m4a')) {
      contentType = 'audio/mp4';
    } else {
      // 如果扩展名和URL模式无法判断，尝试从响应头获取
      try {
        contentType = response && response.headers ? response.headers.get('content-type') : '';
      } catch (err) {
        contentType = '';
      }
      // 如果响应头也没有有效的content-type，尝试根据内容特征判断
      if (!contentType || contentType === 'application/octet-stream') {
        // 设置默认的内容类型，优先考虑音频格式
        contentType = isAudioUrl ? 'audio/aac' : 'application/octet-stream';
      }
    }
    
    // 确保内容类型始终有效
    if (!contentType || contentType === '') {
      contentType = isAudioUrl ? 'audio/aac' : 'application/octet-stream';
    }
    // 增强的响应头设置，确保音频正确播放
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=7200",
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "X-Content-Type-Options": "nosniff",
      // 确保音频流可以被正确缓冲
      "Connection": "keep-alive"
    });
    
    // 如果是小文件才缓存，大文件直接流传输
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) < 1024 * 1024) { // 小于1MB的文件
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      // 对于PHP脚本URL，使用带时间戳的缓存键，并设置较短的TTL
      const storageKey = targetUrl.includes('.php') ? 
                        `${targetUrl}_${Math.floor(Date.now() / 300000)}` : 
                        targetUrl;
      const ttl = targetUrl.includes('.php') ? 300 : 7200; // PHP脚本5分钟，其他2小时
      cache.set(storageKey, buffer, ttl);
      return res.send(buffer);
    } else {
      // 大文件使用流式传输
      console.log('大文件使用流式传输以提高性能');
      response.body.pipe(res);
      return;
    }

  } catch (error) {
    // 增强的错误处理和日志记录
    const timestamp = new Date().toISOString();
    const errorContext = {
      timestamp,
      url: targetUrl,
      path: req.path,
      method: req.method,
      clientIp: req.ip
    };
    
    console.error('🔴 代理请求错误:', errorContext, error.message || error);
    
    if (error.response) {
      console.error('🔴 错误响应状态:', error.response.status);
      console.error('🔴 错误响应头:', error.response.headers);
      if (error.response.data && typeof error.response.data === 'string' && error.response.data.length < 1000) {
        console.error('🔴 错误响应数据:', error.response.data.substring(0, 500) + (error.response.data.length > 500 ? '...' : ''));
      }
    }
    
    console.error('🔴 错误堆栈:', error.stack.split('\n').slice(0, 5).join('\n')); // 只记录前5行堆栈以避免日志过长
    
    // 根据错误类型提供不同的状态码和消息
    let statusCode = 500;
    let errorMessage = "Failed to fetch data";
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      statusCode = 502; // Bad Gateway
      errorMessage = "Failed to connect to upstream server";
    } else if (error.code === 'ETIMEDOUT') {
      statusCode = 504; // Gateway Timeout
      errorMessage = "Upstream server timed out";
    } else if (error.response && error.response.status) {
      statusCode = error.response.status;
    }
    
    // 返回更详细的错误信息，但避免暴露敏感内容
    return res.status(statusCode).json({
      error: errorMessage,
      details: error.message || String(error),
      timestamp,
      path: req.path,
      // 不返回完整的targetUrl以避免暴露上游服务器信息
      requestId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    });
  }
});

// 全局错误处理中间件 - 增强版本
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.error('🚨 全局服务器错误:', {
    timestamp,
    requestId,
    path: req.path,
    method: req.method,
    clientIp: req.ip,
    error: err.message || String(err)
  });
  
  console.error('🚨 错误堆栈:', err.stack.split('\n').slice(0, 5).join('\n'));
  
  // 向客户端返回友好的错误信息，但不暴露内部细节
  res.status(err.status || 500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === 'production' ? 
      "Something went wrong while processing your request" : 
      err.message || "Unknown error",
    timestamp,
    requestId,
    path: req.path
  });
});

// 添加一个健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
