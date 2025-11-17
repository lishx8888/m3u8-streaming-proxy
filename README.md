# 流媒体代理服务器

一个用于代理和重写 `.m3u8` 流媒体URL的Node.js应用程序，具有**缓存**、**源站锁定**、**速率限制**、**日志记录**和**Docker支持**等功能。

## 📋 功能特点
- **高效缓存**：响应缓存在内存中，减少对源站服务器的重复请求，显著提升播放流畅度。
- **源站锁定**：通过只允许来自特定源的请求来限制对代理的访问，增强安全性。
- **智能速率限制**：通过限制单个IP的请求数量来防止滥用和DDoS攻击。
- **详细日志记录**：记录HTTP请求，便于监控、调试和分析使用情况。
- **安全头部设置**：自动添加安全相关的HTTP头部，防止常见的Web漏洞。
- **Docker容器化**：提供完整的Docker支持，实现一键部署和环境一致性。
- **健康检查机制**：提供API端点用于监控应用程序的运行状态。

## 🛠 使用的技术
- **Node.js**：基于事件驱动的JavaScript运行时环境。
- **Express.js**：轻量级Web服务器框架，提供路由和中间件功能。
- **hls.js**：强大的JavaScript库，用于在浏览器中无缝播放HLS流媒体。
- **node-fetch**：为Node.js环境提供与浏览器兼容的Fetch API实现。
- **dotenv**：简单高效的环境变量管理工具。

## 🚀 安装和部署指南

### 一键部署（最简单方式）

#### 部署到Render
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/metahat/m3u8-streaming-proxy)

#### 部署到Vercel
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/metahat/m3u8-streaming-proxy)

### 本地开发和部署（详细步骤）

#### 先决条件
- **Node.js**：v16或更高版本。您可以从[Node.js官网](https://nodejs.org/)下载安装。
- **npm**：Node包管理器，通常随Node.js一起安装。
- **Git**：用于克隆仓库。

#### 详细安装步骤

1. **克隆代码仓库**
   ```bash
   git clone https://github.com/MetaHat/m3u8-streaming-proxy.git
   cd m3u8-streaming-proxy
   ```

2. **安装项目依赖**
   ```bash
   npm install
   ```
   此命令会自动安装package.json中列出的所有依赖包。

3. **配置环境变量**
   - 在项目根目录创建`.env`文件：
     ```bash
     touch .env  # Linux/Mac
     # 或在Windows命令提示符中：
     echo. > .env
     ```
   - 编辑`.env`文件，添加以下配置（根据您的需求调整）：
     ```env
     # 服务器端口（默认为3000）
     PORT=3000
     
     # 可选：自定义缓存大小（单位：MB）
     CACHE_SIZE_MB=100
     
     # 可选：缓存过期时间（单位：秒）
     CACHE_TTL=3600
     ```

4. **启动服务器**
   - **开发环境**（带热重载功能）：
     ```bash
     npm run dev
     ```
     此模式下，代码修改后服务器会自动重启。
   
   - **生产环境**：
     ```bash
     npm start
     ```

5. **验证安装**
   - 打开浏览器，访问：`http://localhost:3000`
   - 如果一切正常，您将看到流媒体播放器界面。

## 💻 详细使用方法

### 1. 使用代理API

#### 基本API调用
- **端点**：`/api/v1/streamingProxy`
- **方法**：GET
- **必需参数**：`url` - 要代理的原始.m3u8或.ts文件URL

**调用示例**：
```
http://localhost:3000/api/v1/streamingProxy?url=https://example.com/stream/playlist.m3u8
```

#### 高级选项
- **自定义Referer**：可以通过添加`referer`查询参数来设置自定义的HTTP Referer头：
  ```
  http://localhost:3000/api/v1/streamingProxy?url=...&referer=https://your-custom-referer.com
  ```

### 2. 使用Web界面播放

1. 打开Web界面：`http://localhost:3000`
2. 在输入框中粘贴您的`.m3u8`流媒体URL
3. 点击「加载流」按钮
4. 视频将开始播放，您可以使用播放器控件进行暂停、调整音量等操作

### 3. 在其他应用中集成

您可以在其他应用或网页中通过以下方式集成此代理服务：

**HTML示例**：
```html
<video id="player" controls width="800" height="450"></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>
<script>
  const video = document.getElementById('player');
  const m3u8Url = 'https://example.com/stream/playlist.m3u8';
  const proxyUrl = `http://your-proxy-server.com/api/v1/streamingProxy?url=${encodeURIComponent(m3u8Url)}`;
  
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(proxyUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play();
    });
  }
</script>
```

## ⚙️ 配置选项

### 1. 服务器配置

在`src/server.js`文件中，您可以修改以下关键配置：

- **缓存设置**：
  ```javascript
  // 缓存配置
  const CACHE_SIZE = process.env.CACHE_SIZE_MB ? parseInt(process.env.CACHE_SIZE_MB) * 1024 * 1024 : 100 * 1024 * 1024; // 默认100MB
  const CACHE_TTL = process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL) : 3600; // 默认1小时
  ```

- **源站锁定**：
  ```javascript
  // 允许的源站列表
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    // 添加您的域名
  ];
  ```

- **速率限制**：
  ```javascript
  // 速率限制配置
  const rateLimitOptions = {
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100 // 每IP限制请求数
  };
  ```

### 2. 环境变量

可以在`.env`文件中配置以下环境变量：

| 环境变量 | 描述 | 默认值 | 示例 |
|---------|------|-------|------|
| PORT | 服务器监听端口 | 3000 | PORT=8080 |
| CACHE_SIZE_MB | 缓存大小（MB） | 100 | CACHE_SIZE_MB=200 |
| CACHE_TTL | 缓存过期时间（秒） | 3600 | CACHE_TTL=7200 |

## 🔧 API详细参考

### GET `/api/v1/streamingProxy`

- **描述**：代理并重写`.m3u8`播放列表和`.ts`片段文件
- **查询参数**：
  - `url`（必需）：要代理的原始.m3u8或.ts文件URL
  - `referer`（可选）：自定义HTTP Referer头

- **响应**：
  - 对于`.m3u8`播放列表：返回重写后的播放列表内容，所有URL都被替换为代理URL
  - 对于`.ts`片段：直接返回二进制视频片段数据
  - 错误情况：返回JSON格式的错误信息

- **响应头**：
  - 自动设置适当的`Content-Type`
  - 添加安全相关的HTTP头部
  - 设置缓存控制头部

### GET `/health`

- **描述**：健康检查端点，用于监控服务状态
- **响应**：
  ```json
  {
    "status": "ok",
    "timestamp": "2023-06-15T10:30:00Z",
    "uptime": 3600
  }
  ```

## 📊 示例URL

以下是一些可用于测试的公开`.m3u8`流媒体URL：

1. **Big Buck Bunny（高清晰度测试视频）**：
   ```
   https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
   ```

2. **Apple示例流**：
   ```
   https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8
   ```

3. **NASA直播**（可能需要特定时段才可用）：
   ```
   https://nasa.gov/multimedia/nasatv/NTV-Public-IPS.m3u8
   ```

## 🔒 安全注意事项

- 生产环境中请确保配置正确的`allowedOrigins`列表，避免未授权访问
- 建议启用速率限制以防止API滥用
- 定期更新依赖包以修复潜在的安全漏洞
- 对于敏感内容，请考虑添加额外的身份验证机制

## 🐳 Docker部署

### 使用Docker运行

1. **构建Docker镜像**：
   ```bash
   docker build -t m3u8-streaming-proxy .
   ```

2. **运行容器**：
   ```bash
   docker run -d -p 3000:3000 \
     -e PORT=3000 \
     -e CACHE_SIZE_MB=100 \
     -e CACHE_TTL=3600 \
     --name m3u8-proxy \
     m3u8-streaming-proxy
   ```

3. **使用Docker Compose**：
   创建`docker-compose.yml`文件：
   ```yaml
   version: '3'
   services:
     m3u8-proxy:
       build: .
       ports:
         - "3000:3000"
       environment:
         - PORT=3000
         - CACHE_SIZE_MB=100
         - CACHE_TTL=3600
       restart: unless-stopped
   ```

   然后运行：
   ```bash
   docker-compose up -d
   ```

## 🤝 贡献指南

我们欢迎社区贡献！请按照以下步骤参与：

1. **Fork** 本仓库到您自己的GitHub账户
2. **创建** 一个新的功能分支：`git checkout -b feature/amazing-feature`
3. **提交** 您的更改：`git commit -m '添加了一个很棒的功能'`
4. **推送到** 您的分支：`git push origin feature/amazing-feature`
5. **开启** 一个Pull Request，详细描述您的更改

### 开发工作流

- 确保您的代码遵循项目的编码风格
- 添加适当的注释和文档
- 为新功能编写测试（如果适用）
- 确保现有测试通过

## 📄 许可证

本项目采用MIT许可证。有关详细信息，请参阅[LICENSE](LICENSE)文件。

## 💬 支持和反馈

如果您遇到任何问题或有建议，请：

1. 查看[GitHub Issues](https://github.com/metahat/m3u8-streaming-proxy/issues)是否已有类似问题
2. 如果没有，请[创建一个新的Issue](https://github.com/metahat/m3u8-streaming-proxy/issues/new)
3. 提供详细的问题描述，包括错误信息和重现步骤（如果可能）

## 📢 鸣谢

- 由[Metahat](https://github.com/metahat)创建和维护
- 感谢所有贡献者和用户的支持
- 使用❤️和开源工具构建

