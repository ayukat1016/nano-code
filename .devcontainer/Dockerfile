# セキュアで最小限のBun開発環境
# 非rootユーザー / 権限制限 / プロジェクトディレクトリのみ
FROM oven/bun:1.3

# 必須ツールのみ（git, jq, curl, nano, gh）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    jq \
    curl \
    ca-certificates \
    gnupg \
    nano  \
    bubblewrap \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# 非rootユーザーを作成
RUN useradd -ms /bin/bash vscode
USER vscode
WORKDIR /nano-code

# 基本環境変数（nanoはテキストエディタ、プロジェクト名とは無関係）
ENV EDITOR=nano
ENV DEVCONTAINER=true
ENV PATH="/home/vscode/.bun/bin:$PATH"

# Bunのキャッシュをユーザーごとに分離
ENV BUN_INSTALL_CACHE=/home/vscode/.bun-cache
RUN mkdir -p $BUN_INSTALL_CACHE

CMD ["bash"]
