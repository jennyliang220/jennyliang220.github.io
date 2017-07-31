# 《Web 开发指南》编写指南

## 1. 下载文档源码

```
git clone ssh://g@gitlab.baidu.com:8022/psfe/web-developer.git;
cd web-developer
```

## 2. 编写文档并配置目录

文档位于各个文件夹下，使用markdown格式编写。  
目录为 [SUMMARY.md](http://gitlab.baidu.com/psfe/web-developer/raw/master/SUMMARY.md)(线下根目录也有对应文件), 在其中按照目录结构加入新写的文档即可。

## 3. 预览

#### 1. 预览效果前，需要安装 gitbook-cli

```
npm install;
gitbook -V
```
如果报错 gitbook 不存在，则强制安装：`[sudo] npm install -g gitbook-cli`  

#### 2. 安装gitbook插件

```
gitbook install;
```
#### 3. 预览效果

```
gitbook serve;
```
访问localhost:4000可以看到效果。

#### 4. 提交代码
略