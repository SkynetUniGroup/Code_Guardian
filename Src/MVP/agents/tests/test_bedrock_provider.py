"""Tests for the Bedrock LLM provider.

Verifies error handling and integration with AWS Bedrock services.
"""

from unittest.mock import patch

import botocore.exceptions
import pytest

from src.config import settings
from src.llm import BedrockProvider


@pytest.mark.asyncio
async def test_bedrock_inference_profile_arn_error() -> None:
    """Verifies the handling of Inference Profile ARN validation errors.

    Ensures that BedrockProvider correctly intercepts the ValidationException
    raised when a standard Model ID is used instead of an Inference Profile ARN.
    """
    error_response = {
        'Error': {
            'Code': 'ValidationException',
            'Message': 'Invocation of model ID is not supported. Please use an Inference Profile ARN.'
        }
    }
    mock_client_error = botocore.exceptions.ClientError(error_response, 'InvokeModel')

    provider = BedrockProvider(model=settings.llm_model_general)

    with patch('src.llm.ChatBedrockConverse.ainvoke', side_effect=mock_client_error):
        with pytest.raises(RuntimeError) as exc_info:
            await provider.complete('Hello, test', timeout_s=30)
            
        error_msg = str(exc_info.value)
        
        assert 'AWS Bedrock invocation failed' in error_msg
        assert 'Inference Profile ARN' in error_msg