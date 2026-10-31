from fastapi import Request

from app.storage.interfaces import Storage


def get_storage(request: Request) -> Storage:
    return request.app.state.storage
