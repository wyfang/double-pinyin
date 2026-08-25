# Double Pinyin

在浏览器中把连续的小鹤双拼编码转换为中文，使用随项目分发的 Rime Ice 词典完成确定性选词。

## 功能

- 支持连续双拼、空格或撇号分隔的编码，并保留数字和标点
- 根据词频和短语长度选择单一结果，最长按 8 个音节组合
- 支持 `Enter` 转换、`Shift + Enter` 换行、`Esc` 清空
- 自动适配字号、明暗主题与减少动态效果偏好

## 使用

项目是原生 HTML、CSS 和 JavaScript 静态站点，无需安装依赖。由于词典通过同源请求加载，不能直接双击 `index.html`：

```bash
python3 -m http.server 8000
```

打开 <http://127.0.0.1:8000/>，输入小鹤双拼编码后按 `Enter`。例如 `nihc` 会转换为“你好”。

## 数据与限制

首次打开需要从当前站点读取约 16.7 MB 的词典。浏览器会把词典全文缓存在 IndexedDB 的 `decode-dictionary-cache` 中；输入与输出不会持久化，也不会发送到业务后端。清除该站点的浏览器数据即可删除缓存。

当前仅支持小鹤双拼映射，输出没有候选列表、用户词频学习、声调或纠错功能。词典覆盖与多音字选择可能影响结果。页面需要启用 JavaScript；支持 IndexedDB 时会缓存词典，禁用时每次打开都需重新加载。

## 版权说明

本项目自有代码保留所有权利，不因私有仓库访问权限产生授权。Rime Ice 词典依据 GNU GPL v3.0 分发，Noto Serif SC 与 Share Tech Mono 字体依据 SIL Open Font License 1.1 分发；来源与版本见 [第三方说明](./THIRD_PARTY_NOTICES.md)，许可边界见 [LICENSE_SCOPE.md](./LICENSE_SCOPE.md)。
